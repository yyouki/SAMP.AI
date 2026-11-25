#!/usr/bin/env bash
set -Eeuo pipefail

# Pinned toolchain versions: update these only with a tested dependency change.
readonly PAWN_COMPILER_VERSION="3.10.11"
readonly PAWN_COMPILER_URL="https://github.com/openmultiplayer/compiler/releases/download/v3.10.11/pawnc-3.10.11-linux.tar.gz"
readonly PAWN_COMPILER_SHA256="13977433acb1dfb23e3ec6354f622115d5073e97aced9395058a9db59d2564c2"
readonly SAMP_STDLIB_SHA="8ffb055624308b25521665b60e78b5e6e6b3717f"
readonly PAWN_STDLIB_SHA="e96507d9a6ddaae5bb0f3ec31479ba805aeff964"
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
echo "Using compiler: $PAWNCC"
"$PAWNCC" 2>&1 | head -n 12 || true

echo "Downloading pinned HTTPS and JSON Pawn includes..."
download "$HTTPS_SAMP_URL" "$INCLUDE_ROOT/https_samp.inc"
echo "$HTTPS_SAMP_SHA256  $INCLUDE_ROOT/https_samp.inc" | sha256sum --check --status
download "https://raw.githubusercontent.com/NimaBastani/pawn-json-parser/$JSON_PARSER_SHA/json_parser.inc" "$INCLUDE_ROOT/json_parser.inc"

echo "Preparing SA-MP standard includes..."
SAMP_INCLUDE="$BUILD_ROOT/includes-samp"
PAWN_INCLUDE="$BUILD_ROOT/includes-pawn"
extract_github_repo "pawn-lang/samp-stdlib" "$SAMP_STDLIB_SHA" "$SAMP_INCLUDE"
extract_github_repo "pawn-lang/pawn-stdlib" "$PAWN_STDLIB_SHA" "$PAWN_INCLUDE"
mkdir -p "$INCLUDE_ROOT/samp"
cp "$PAWN_INCLUDE"/*.inc "$INCLUDE_ROOT/samp/"
cp "$SAMP_INCLUDE"/*.inc "$INCLUDE_ROOT/samp/"
cp "$INCLUDE_ROOT/https_samp.inc" "$INCLUDE_ROOT/samp/"
cp "$INCLUDE_ROOT/json_parser.inc" "$INCLUDE_ROOT/samp/"

echo "Preparing open.mp standard includes..."
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

compile_target "samp" "$INCLUDE_ROOT/samp"
# The official open.mp include package provides a_samp compatibility wrappers.
compile_target "openmp" "$INCLUDE_ROOT/openmp" "-DSAMP_COMPAT"

cat > "$OUTPUT_DIR/build-info.txt" <<EOF
SAMP.AI Pawn build provenance
Source commit: ${GITHUB_SHA:-local}
Pawn compiler: openmultiplayer/compiler v$PAWN_COMPILER_VERSION
SA-MP include: pawn-lang/samp-stdlib@$SAMP_STDLIB_SHA
Pawn standard include: pawn-lang/pawn-stdlib@$PAWN_STDLIB_SHA
open.mp include: openmultiplayer/omp-stdlib@$OMP_STDLIB_SHA
HTTPS include: https_samp $HTTPS_SAMP_VERSION
JSON include: pawn-json-parser@$JSON_PARSER_SHA
EOF

echo "Pawn compilation finished successfully."
