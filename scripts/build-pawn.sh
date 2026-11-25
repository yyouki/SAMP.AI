#!/usr/bin/env bash
set -Eeuo pipefail

# Pinned toolchain versions: update these only with a tested dependency change.
readonly PAWN_COMPILER_VERSION="3.10.11"
readonly PAWN_COMPILER_URL="https://github.com/openmultiplayer/compiler/releases/download/v3.10.11/pawnc-3.10.11-linux.tar.gz"
readonly PAWN_COMPILER_SHA256="13977433acb1dfb23e3ec6354f622115d5073e97aced9395058a9db59d2564c2"
readonly OMP_STDLIB_SHA="17c1b0191195cb0b59a820135fbca622c84129dd"
readonly JSON_PARSER_SHA="deb7a60a40cc95f734611deb6b9c1b2a9d457949"
readonly HTTPS_SAMP_VERSION="v1.0.0"
readonly HTTPS_SAMP_URL="https://github.com/NullSablex/https_samp/releases/download/v1.0.0/https_samp.inc"
readonly HTTPS_SAMP_SHA256="2e0e982502b22b624598cf5735e131cb060ed8ab961f4c5f69e50265dc91188e"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${PAWN_BUILD_ROOT:-}" ]]; then
  PAWN_BUILD_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/samp-ai-pawn-build"
fi
if [[ -z "${1:-}" ]]; then
  OUTPUT_DIR="$ROOT_DIR/artifacts/pawn"
else
  OUTPUT_DIR="$1"
fi
BUILD_ROOT="$PAWN_BUILD_ROOT"
TOOLCHAIN_DIR="$BUILD_ROOT/compiler"
INCLUDE_ROOT="$BUILD_ROOT/include"
DOWNLOAD_DIR="$BUILD_ROOT/downloads"

mkdir -p "$TOOLCHAIN_DIR" "$INCLUDE_ROOT" "$DOWNLOAD_DIR" "$OUTPUT_DIR"

download() {
  local url="$1"
  local output="$2"
  curl --fail --location --retry 3 --retry-delay 2 --silent --show-error "$url" --output "$output"
}

extract_github_repo() {
  local repo="$1"
  local revision="$2"
  local destination="$3"
  local archive="$DOWNLOAD_DIR/$(echo "$repo" | tr '/' '-')-$revision.tar.gz"
  download "https://codeload.github.com/$repo/tar.gz/$revision" "$archive"
  mkdir -p "$destination"
  tar -xzf "$archive" --strip-components=1 -C "$destination"
}

echo "Downloading pinned Pawn compiler $PAWN_COMPILER_VERSION..."
COMPILER_ARCHIVE="$DOWNLOAD_DIR/pawnc-$PAWN_COMPILER_VERSION-linux.tar.gz"
download "$PAWN_COMPILER_URL" "$COMPILER_ARCHIVE"
echo "$PAWN_COMPILER_SHA256  $COMPILER_ARCHIVE" | sha256sum --check --status

tar -xzf "$COMPILER_ARCHIVE" -C "$TOOLCHAIN_DIR"
PAWNCC="$(find "$TOOLCHAIN_DIR" -type f -name pawncc -print -quit)"
if [[ -z "$PAWNCC" ]]; then
  echo "::error::pawncc was not found inside the official compiler archive."
  find "$TOOLCHAIN_DIR" -maxdepth 4 -type f -print
  exit 1
fi
chmod +x "$PAWNCC"
PAWNCC_DIR="$(dirname "$PAWNCC")"
PAWN_LIB_FILE="$(find "$TOOLCHAIN_DIR" -type f -name libpawnc.so -print -quit)"
if [[ -z "$PAWN_LIB_FILE" ]]; then
  echo "::error::libpawnc.so was not found inside the official compiler archive."
  find "$TOOLCHAIN_DIR" -maxdepth 5 -type f -print
  exit 1
fi
PAWN_LIB_DIR="$(dirname "$PAWN_LIB_FILE")"
export LD_LIBRARY_PATH="$PAWN_LIB_DIR:$PAWNCC_DIR:${LD_LIBRARY_PATH:-}"
if ldd "$PAWNCC" | grep -q "not found"; then
  echo "::error::The Pawn compiler still has unresolved shared-library dependencies."
  ldd "$PAWNCC"
  exit 1
fi
echo "Using compiler: $PAWNCC"
echo "Using compiler libraries: $PAWN_LIB_DIR"

echo "Downloading pinned HTTPS and JSON Pawn includes..."
download "$HTTPS_SAMP_URL" "$INCLUDE_ROOT/https_samp.inc"
echo "$HTTPS_SAMP_SHA256  $INCLUDE_ROOT/https_samp.inc" | sha256sum --check --status
download "https://raw.githubusercontent.com/NimaBastani/pawn-json-parser/$JSON_PARSER_SHA/json_parser.inc" "$INCLUDE_ROOT/json_parser.inc"
# The parser references this pool limit in its static node table. Define it
# inside the include itself so it is available regardless of include order.
PARSER_PATCHED="$DOWNLOAD_DIR/json_parser.patched.inc"
awk '
  /#if !defined JSON_MAX_NODES/ { skip = 1; next }
  skip && /#endif/ { skip = 0; next }
  !skip {
    gsub(/JSON_MAX_NODES/, "4096")
    print
  }
' "$INCLUDE_ROOT/json_parser.inc" > "$PARSER_PATCHED"
mv "$PARSER_PATCHED" "$INCLUDE_ROOT/json_parser.inc"
if grep -q "JSON_MAX_NODES" "$INCLUDE_ROOT/json_parser.inc"; then
  echo "::error::Failed to patch JSON_MAX_NODES in the pinned JSON parser."
  exit 1
fi
echo "Patched JSON parser node pool to 4096 entries."

echo "Preparing open.mp standard includes and SA-MP compatibility mode..."
OMP_INCLUDE="$BUILD_ROOT/includes-openmp"
extract_github_repo "openmultiplayer/omp-stdlib" "$OMP_STDLIB_SHA" "$OMP_INCLUDE"
mkdir -p "$INCLUDE_ROOT/openmp"
cp "$OMP_INCLUDE"/*.inc "$INCLUDE_ROOT/openmp/"
cp "$INCLUDE_ROOT/https_samp.inc" "$INCLUDE_ROOT/openmp/"
cp "$INCLUDE_ROOT/json_parser.inc" "$INCLUDE_ROOT/openmp/"

SOURCE="$ROOT_DIR/adapters/pawn/samp_ai_adapter.pwn"
if [[ ! -f "$SOURCE" ]]; then
  echo "::error::Pawn adapter source not found: $SOURCE"
  exit 1
fi

compile_target() {
  local target="$1"
  local includes="$2"
  shift 2
  local target_dir="$OUTPUT_DIR/$target"
  local output="$target_dir/samp_ai_adapter.amx"

  mkdir -p "$target_dir"
  echo "Compiling Pawn adapter for $target..."
  "$PAWNCC" \
    "-i$includes" \
    "-i$INCLUDE_ROOT" \
    -d0 \
    -O2 \
    -Z \
    "$@" \
    "-o$output" \
    "$SOURCE"

  if [[ ! -s "$output" ]]; then
    echo "::error::Compiler did not produce $output"
    exit 1
  fi
  echo "Built $output ($(stat -c '%s' "$output") bytes)"
}

# SAMP_COMPAT enables the legacy a_samp surface and untagged callback prototypes.
compile_target "samp" "$INCLUDE_ROOT/openmp" "-DSAMP_COMPAT" "-DSAMP_AI_OPEN_MP" "-DSAMP_AI_OPEN_MP"
compile_target "openmp" "$INCLUDE_ROOT/openmp" "-DSAMP_AI_OPEN_MP"


cat > "$OUTPUT_DIR/build-info.txt" <<EOF
SAMP.AI Pawn build provenance
Source commit: ${GITHUB_SHA:-local}
Pawn compiler: openmultiplayer/compiler v$PAWN_COMPILER_VERSION
SA-MP target: openmultiplayer/omp-stdlib@$OMP_STDLIB_SHA with SAMP_COMPAT
open.mp target: openmultiplayer/omp-stdlib@$OMP_STDLIB_SHA
HTTPS include: https_samp $HTTPS_SAMP_VERSION
JSON include: pawn-json-parser@$JSON_PARSER_SHA
EOF

echo "Pawn compilation finished successfully."
