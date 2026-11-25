# Build and GitHub Releases

> **Language:** [English](RELEASING.md) | [Bahasa Indonesia](id/RELEASING.md) · [Documentation index](INDEX.md)

The .github/workflows/ci.yml workflow combines TypeScript validation, Pawn compilation, and tag-triggered GitHub Release publishing.

## CI on pushes and pull requests

Every push to main, pull request, and manual workflow_dispatch runs two validation jobs:

1. Node.js 22 installs dependencies, type-checks source/tests, runs tests, and builds TypeScript output into dist/.
2. scripts/build-pawn.sh downloads pinned compiler/include dependencies and compiles the reference filterscript for SA-MP and open.mp.

Successful runs upload samp-ai-dist and samp-ai-pawn-build as temporary workflow artifacts. If either validation job fails, the workflow does not publish a release.

## Publish a version

After reviewing a commit on main, create and push a semantic version tag:

~~~bash
git checkout main
git pull --ff-only
git tag v0.2.0
git push origin v0.2.0
~~~

A v* tag triggers the same validation jobs. publish-release depends on both validate and build-pawn and runs only after both succeed.

## Release assets

- samp-ai-vX.Y.Z.zip and .tar.gz: reference bundle with TypeScript dist/, Pawn source/config, schemas, and docs.
- Separate samp_ai_adapter.amx files for SA-MP and open.mp.
- build-info.txt with compiler and include provenance.
- .sha256 checksums for archive files.

Regular Actions artifacts are temporary and expire according to their retention setting. GitHub Release assets remain attached to the tagged version.

The release is a reference integration bundle, not a complete backend application or one-click installer. It does not include server secrets, third-party plugin binaries, durable database, admin dashboard, or a production approval service. Successful compilation does not prove the filterscript has been live-tested on a game server. Choose a project license and review third-party dependency licenses before production distribution.
