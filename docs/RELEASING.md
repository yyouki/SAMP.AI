# Build and GitHub Releases

> **Language:** [English](RELEASING.md) | [Bahasa Indonesia](id/RELEASING.md) · [Documentation index](INDEX.md)

The .github/workflows/ci.yml workflow combines TypeScript validation, Pawn compilation, and GitHub Release publishing.

## CI on pushes and pull requests

Every push to main, pull request, and manual workflow_dispatch runs two validation jobs:

1. Node.js 22 installs dependencies, type-checks source/tests, runs tests, and builds TypeScript output into dist/.
2. scripts/build-pawn.sh downloads pinned compiler/include dependencies and compiles the reference filterscript for SA-MP and open.mp.

Successful runs upload samp-ai-dist and samp-ai-pawn-build as temporary workflow artifacts. If either validation job fails, the workflow does not publish a release.

## What is samp-ai-dist?

The samp-ai-dist workflow artifact contains only the generated dist/ directory: JavaScript modules, TypeScript declaration files (.d.ts), and source maps. It is a build output for applications that want to import the SAMP.AI core without compiling TypeScript again. It is not a standalone server or installer and does not include node_modules. Use Node.js 22+ and install the runtime dependencies listed in package.json.

The artifact is temporary and is retained for 14 days. The full samp-ai-vX.Y.Z.zip release bundle is the better download for integration: it also includes Pawn source/config, compiled SA-MP and open.mp .amx files, schemas, documentation, and build metadata.

## Publish a version

For a regular release, create and push a semantic version tag matching package.json:

~~~bash
git checkout main
git pull --ff-only
git tag vX.Y.Z
git push origin vX.Y.Z
~~~

For an automated release directly from main, a commit whose complete message is exactly release: vX.Y.Z also triggers the release pipeline. The workflow verifies that the version matches package.json, runs both validation jobs, and then creates the matching tag and GitHub Release on that commit.

The publish-release job runs only after validate and build-pawn succeed.

## Release assets

- samp-ai-vX.Y.Z.zip and .tar.gz: reference bundle with TypeScript dist/, Pawn source/config, schemas, and docs.
- Separate samp_ai_adapter.amx files for SA-MP and open.mp.
- build-info.txt with compiler and include provenance.
- .sha256 checksums for archive files.

Regular Actions artifacts are temporary and expire according to their retention setting. GitHub Release assets remain attached to the tagged version.

The release is a reference integration bundle, not a complete backend application or one-click installer. It does not include server secrets, third-party plugin binaries, durable database, admin dashboard, or a production approval service. Successful compilation does not prove the filterscript has been live-tested on a game server. Choose a project license and review third-party dependency licenses before production distribution.
