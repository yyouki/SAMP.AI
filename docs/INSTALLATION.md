# Installation Guide (Reference Integration)

**Status:** SAMP.AI is not yet a one-file plugin or a fully packaged application. This guide installs the current reference Pawn bridge and explains the backend integration it needs. It is suitable for development/integration testing, not a production deployment without the hardening items below.

## What runs where

SAMP.AI currently has two separate parts:

1. **Node.js backend:** hosts the adapter registry, typed task queue, and authenticated HTTP gateway. The AI agent, trusted admin authentication, approval UI, and production storage still need to be wired by the host application.
2. **Pawn filterscript:** runs inside the SA-MP/open.mp server. It reads player state, creates a global mapping object, creates a private per-player preview, and opens the in-game preview editor.

Copying only the `.amx` file into a game server is not enough. The filterscript must be able to reach a running HTTPS gateway with a matching adapter token.

## Requirements

- Node.js 22 or newer for the backend libraries.
- A SA-MP or open.mp server and a Pawn compiler/includes matching the server runtime.
- The `https_samp` v1.0.0 binary and matching `https_samp.inc`.
- The `json_parser.inc` include from the separate pawn-json-parser project.
- A public HTTPS hostname or a private HTTPS endpoint reachable from the game server.
- A unique, high-entropy adapter token. Do not use a real token in source code or a committed config file.

External dependency projects:

- [https_samp releases](https://github.com/NullSablex/https_samp/releases) — the published v1.0.0 release includes Windows `.dll`, Linux `.so`, and `https_samp.inc`. The project declares AGPL-3.0-or-later.
- [pawn-json-parser](https://github.com/NimaBastani/pawn-json-parser) — copy `json_parser.inc` into the Pawn compiler include directory. Its project declares MIT.

Review those dependencies' current licenses and distribution obligations before bundling them with a server package.

## 1. Get and build the SAMP.AI backend library

On the machine that will host the backend:

```bash
git clone https://github.com/yyouki/samp-ai.git
cd samp-ai
npm install
npm run typecheck
npm test
npm run build
```

This builds and verifies the TypeScript library. **It does not launch a complete AI application.** The repository does not yet contain a production backend entry point, admin dashboard, public task-enqueue API, or durable database.

A host application must instantiate these components and connect them to its own trusted authentication and approval services:

- `AdapterRegistry` and `ProtocolValidator`
- `AdapterActionRegistry` with `registerPawnAdapterActions(...)`
- `AdapterTaskQueue` and `JsonSchemaValidator`
- `HttpAdapterGateway` and an `AdapterAuthenticator`
- `MappingPreviewEditOrchestrator`, a durable draft revision store, and an approval request/verification service

The wiring example in [Pawn Adapter](PAWN_ADAPTER.md) shows the core registry and gateway setup. `InMemoryBearerAdapterAuthenticator` is for development only. The current gateway binds plain HTTP; expose it through a trusted HTTPS reverse proxy or an equivalent private TLS transport. Keep the gateway itself on loopback/private networking where possible.

The task queue, adapter registry, and included in-memory revision store lose their contents when the process restarts. The gateway also has no public/admin route for enqueueing tasks; a trusted host application must call the queue directly after authorization checks.

## 2. Install the HTTPS transport

Download the binary and include that match the server OS from the [https_samp v1.0.0 release](https://github.com/NullSablex/https_samp/releases/tag/v1.0.0).

- Copy `https_samp.inc` into the Pawn compiler's include directory.
- Copy `json_parser.inc` from [pawn-json-parser](https://github.com/NimaBastani/pawn-json-parser) into the same include directory.
- For SA-MP, install the plugin binary in the server's `plugins/` directory.
- For open.mp native component mode (recommended by the plugin project), install the binary in the server's `components/` directory.
- open.mp can alternatively load it in legacy plugin mode from `plugins/`.

The release notes state that the same plugin binary supports SA-MP and open.mp; open.mp supports both native component and legacy plugin loading. Follow the exact configuration instructions bundled with the plugin release if they change.

## 3. Download a compiled filterscript from GitHub Actions

Open the repository's **Actions** tab, select the latest successful CI and Release workflow run, and download the `samp-ai-pawn-build` artifact. It contains separate `samp/` and `openmp/` folders and `build-info.txt`.

Workflow artifacts are temporary and expire according to retention settings. For versioned distribution, use the assets attached to a GitHub Release created from a `v*` tag. See [Build and GitHub Releases](RELEASING.md).

## 4. Compile the Pawn filterscript

From the repository, compile:

```text
adapters/pawn/samp_ai_adapter.pwn
```

Use the compiler and base includes that match your game server, plus `https_samp.inc` and `json_parser.inc`. The exact command-line flags depend on the Pawn compiler distribution. The resulting file must be named `samp_ai_adapter.amx` and copied to the game server's `filterscripts/` directory.

The repository's TypeScript CI does not compile Pawn. Treat compiler output and a live server test as separate validation requirements.

## 5. Configure the private adapter credentials

Copy `adapters/pawn/samp_ai_adapter.example.json` to the server's `scriptfiles/samp_ai_adapter.json`.

Example configuration:

```json
{
  "gateway_base_url": "https://samp-ai.example.com",
  "adapter_token": "REPLACE_WITH_A_UNIQUE_SERVER_ADAPTER_TOKEN",
  "server_instance_id": "your-server-instance-id",
  "adapter_id": "sampai-pawn",
  "runtime": "open.mp",
  "server_clock_is_utc": true
}
```

Set `runtime` to the runtime name used by your deployment (`open.mp` or `samp`). The token, `server_instance_id`, and `adapter_id` must match the credential identity configured in the backend authenticator.

The sample requires `gateway_base_url` to use HTTPS. Its protocol timestamps include a UTC `Z` suffix; ensure the host OS clock/timezone is actually UTC and synchronized before setting `server_clock_is_utc` to `true`. This setting is an operator assertion, not an automatic timezone conversion.

The live config file is ignored by Git. Keep it readable only by the server process/operator. Never commit the real token.

## 6. Load it in SA-MP

Stop the SA-MP server before copying files or editing its configuration. Put the filterscript at `filterscripts/samp_ai_adapter.amx` and the transport binary in `plugins/`.

In `server.cfg`, add the filterscript and the transport plugin. Use the platform's plugin filename convention:

```text
filterscripts samp_ai_adapter
```

For the transport, the published release provides `https_samp.dll` for Windows and `https_samp.so` for Linux. The SA-MP plugin loader's expected plugin name/extension can differ by server package; follow the `https_samp` release instructions and the convention used by the installed server.

Restart the server and inspect the console for the filterscript's startup and authenticated registration messages.

## 7. Load it in open.mp

Stop the server before copying files or editing `config.json`. Put `samp_ai_adapter.amx` in `filterscripts/`.

### Recommended: native component mode

Put `https_samp.dll` (Windows) or `https_samp.so` (Linux) in the open.mp `components/` folder. The plugin project's v1.0.0 documentation says its open.mp component is discovered automatically; no `pawn.legacy_plugins` entry is required for this mode.

Add the filterscript under `pawn.side_scripts` in `config.json`:

```json
{
  "pawn": {
    "side_scripts": [
      "filterscripts/samp_ai_adapter"
    ]
  }
}
```

Merge this key into your existing `config.json`; do not replace the rest of your server configuration.

### Alternative: legacy plugin mode

Put the HTTPS binary in `plugins/` and add it under `pawn.legacy_plugins`. Keep the filterscript under `pawn.side_scripts`:

```json
{
  "pawn": {
    "legacy_plugins": [
      "https_samp"
    ],
    "side_scripts": [
      "filterscripts/samp_ai_adapter"
    ]
  }
}
```

Do not install the same `https_samp` binary in both `components/` and `plugins/` at the same time. Choose one loading mode.

The open.mp server configuration documents `pawn.side_scripts` for filterscripts and `pawn.legacy_plugins` for legacy `.dll`/`.so` plugins. See the official [open.mp config.json reference](https://open.mp/docs/server/config.json).

## 8. Verify the connection

1. Start the backend host application and verify its `/health` endpoint.
2. Start the game server.
3. Confirm that the filterscript can reach the gateway over HTTPS.
4. Confirm that the adapter sends `adapter.hello` and appears in the backend's adapter registry as `sampai-pawn` for the expected server instance.
5. Confirm that heartbeat traffic keeps the adapter active.

The Pawn reference script polls every 1.5 seconds and sends a heartbeat every 15 seconds. The gateway's default adapter-stale interval is 60 seconds.

## What is and is not usable yet

The six Pawn action contracts cover:

- Player-state reads (position, facing, interior, virtual world, session ID).
- One server-wide `CreateObject` action. It currently accepts only interior 0 / virtual world 0 and remains global; it is not isolated to a player, interior, or virtual world.
- One private `CreatePlayerObject` preview per player.
- Session/preview-bound preview cleanup.
- Opening the native player-object editor.
- Reading the final/cancelled editor state and transform.

The core editor orchestrator can create a revised draft and request approval, then enqueue a global create only after a matching approval receipt is verified. Its provided revision store is in-memory, and the host application must implement the approval UI/service.

This is still an integration scaffold. No packaged installer, production backend host, admin dashboard, durable storage, live-tested Pawn binary, full mapping CRUD, TextDraw workflow, or production-ready credential/approval service is shipped yet. Do not use it to mutate a production server until the exact server/compiler/plugin combination has been compiled and live-tested.