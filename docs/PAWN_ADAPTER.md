# Pawn Adapter (reference integration)

**Status:** reference filterscript; the TypeScript action contracts are covered by CI, but the Pawn file has not yet been compiled against a real server/plugin combination or live-tested. Treat it as an integration starter, not a production-ready adapter.

The sample is in `adapters/pawn/samp_ai_adapter.pwn`. It uses the same authenticated task routes as the TypeScript gateway and executes six allowlisted actions:

| Action | Result |
|---|---|
| `context.get_player_state` | Reads position, facing angle, interior, virtual world, and the current connection-session ID for an online player. |
| `mapping.create_object` | Creates a server-wide global `CreateObject` object. The native does not scope it to one interior or virtual world. |
| `mapping.preview_player_object` | Creates or replaces one temporary `CreatePlayerObject` preview visible only to the target player session. |
| `mapping.begin_player_preview_edit` | Opens the native editor for the exact active private preview and returns immediately. |
| `mapping.get_player_preview_edit_result` | Reads the editor status and last accepted transform for the matching player session and preview ID. |
| `mapping.clear_player_preview` | Removes the preview only when player ID, connection session, and preview ID still match. |

It deliberately does not advertise marker, TextDraw, global mapping deletion/update, native-world removal, or arbitrary code execution capabilities.

## Why an external HTTPS transport is required

The built-in open.mp Pawn `HTTP` native exposes the request method, URL, body, and callback, but not a way to set an `Authorization` header. The SAMP.AI gateway requires a Bearer token for adapter routes, so the example uses the third-party [https_samp plugin](https://github.com/NullSablex/https_samp), whose Pawn API provides HTTPS, request headers, and a one-shot Bearer helper.

The example targets the public `https_samp` v1.0.0 API. Install the matching binary and include from that project's official release/documentation. For open.mp, follow its component/legacy-plugin setup instructions; for SA-MP, follow its plugin setup instructions. Do not copy the plugin's implementation into this repository.

The script also uses [pawn-json-parser](https://github.com/NimaBastani/pawn-json-parser) for JSON parsing and serialization. It is a separate pure-Pawn library; copy its `json_parser.inc` into the compiler include directory. Its README notes that `\\uXXXX` Unicode escapes are not fully supported. Keep adapter IDs and operation identifiers in the ASCII range used by the action schemas.

**License note:** the referenced HTTPS plugin declares AGPL-3.0-or-later, while the JSON parser declares MIT. They are optional external dependencies and are not vendored here. Review each project's current license and distribution requirements before including its binary or source with a server package. SAMP.AI itself has not selected a repository license yet.

## Installation

1. Install `https_samp` v1.0.0 or a verified compatible release, and use the matching `https_samp.inc`. For SA-MP, load it as a plugin. For open.mp, prefer its native component mode by placing the binary in `components/`; legacy plugin mode is also supported.
2. Copy `json_parser.inc` from the JSON parser project into the Pawn compiler's include directory.
3. Copy `adapters/pawn/samp_ai_adapter.example.json` to the game server's `scriptfiles/samp_ai_adapter.json`.
4. Configure the gateway URL, per-server adapter token, server instance ID, adapter ID, and runtime in that private file. The sample requires `server_clock_is_utc: true` because its protocol timestamps are emitted with a UTC `Z` suffix; ensure the host clock is actually configured and synchronized to UTC before setting this flag. The token must be bound in the gateway authenticator to the exact same `adapter_id` and `server_instance_id`.
5. Compile `adapters/pawn/samp_ai_adapter.pwn` with the installed includes and load the resulting filterscript.
6. Configure an HTTPS reverse proxy in front of the Node gateway. The sample rejects a non-HTTPS gateway URL and the gateway itself is plain HTTP unless TLS is terminated by a trusted proxy.

The live file `scriptfiles/samp_ai_adapter.json` is ignored by Git. Never put a real adapter token in the Pawn source, a committed JSON file, a game client, or a log. Restrict access to the server-side config file using the host's operating-system permissions.

## Register the server-side action contracts

The Node.js process must register the Pawn-specific action definitions, not the mock adapter's entire action set:

```ts
import {
  AdapterActionRegistry,
  AdapterRegistry,
  AdapterTaskQueue,
  HttpAdapterGateway,
  JsonSchemaValidator,
  ProtocolValidator,
  createDefaultSchemaValidator,
  registerPawnAdapterActions
} from "../src/index.js";

const adapterRegistry = new AdapterRegistry(
  new ProtocolValidator(createDefaultSchemaValidator())
);

const actionRegistry = new AdapterActionRegistry();
registerPawnAdapterActions(actionRegistry);

const taskQueue = new AdapterTaskQueue(
  adapterRegistry,
  actionRegistry,
  new JsonSchemaValidator()
);

// Supply your production authenticator in place of the development example.
const gateway = new HttpAdapterGateway(
  adapterRegistry,
  authenticator,
  {},
  taskQueue
);
```

The application should enqueue a task only after its own actor permission, project scope, draft hash, and approval policy checks have succeeded. Adapter authentication is machine identity; it is not a substitute for an admin's approval.

The snippets below show the individual task shapes, not a batch to enqueue all at once. Wait for and validate each task result before scheduling the next step. In particular, do not clear the preview or queue `mapping.create_object` until the edit result has been read, the draft has been revised and validated, and the authorized reviewer has explicitly approved the final draft.

Example trusted orchestration calls:

```ts
taskQueue.enqueue({
  serverInstanceId: "your-server-instance-id",
  adapterId: "sampai-pawn",
  actionId: "context.get_player_state",
  idempotencyKey: "player-state-request-0001",
  payload: { player_id: 7 }
});

// First request the target player's current state and connection session.
taskQueue.enqueue({
  serverInstanceId: "your-server-instance-id",
  adapterId: "sampai-pawn",
  actionId: "context.get_player_state",
  idempotencyKey: "reviewer-state-0001",
  payload: { player_id: 7 }
});

// After the context result reports found=true, use its session_id to bind the preview.
// Do not guess or cache a player session ID across reconnects.
taskQueue.enqueue({
  serverInstanceId: "your-server-instance-id",
  adapterId: "sampai-pawn",
  actionId: "mapping.preview_player_object",
  idempotencyKey: "hospital-preview-0001",
  payload: {
    preview_id: "hospital-preview-wall-01",
    project_id: "hospital",
    player_id: 7,
    player_session_id: "<session_id from context.get_player_state>",
    model_id: 19377,
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 90 }
  }
});

  // Start the native editor for this exact player session and preview.
  taskQueue.enqueue({
    serverInstanceId: "your-server-instance-id",
    adapterId: "sampai-pawn",
    actionId: "mapping.begin_player_preview_edit",
    idempotencyKey: "hospital-preview-edit-start-0001",
    payload: {
      preview_id: "hospital-preview-wall-01",
      player_id: 7,
      player_session_id: "<same session_id>"
    }
  });

  // Read this action until its result is completed or cancelled.
  taskQueue.enqueue({
    serverInstanceId: "your-server-instance-id",
    adapterId: "sampai-pawn",
    actionId: "mapping.get_player_preview_edit_result",
    idempotencyKey: "hospital-preview-edit-read-0001",
    payload: {
      preview_id: "hospital-preview-wall-01",
      player_id: 7,
      player_session_id: "<same session_id>"
    }
  });

// Clear only this exact preview for the same connection session.
taskQueue.enqueue({
  serverInstanceId: "your-server-instance-id",
  adapterId: "sampai-pawn",
  actionId: "mapping.clear_player_preview",
  idempotencyKey: "hospital-preview-clear-0001",
  payload: {
    preview_id: "hospital-preview-wall-01",
    player_id: 7,
    player_session_id: "<same session_id>"
  }
});

taskQueue.enqueue({
  serverInstanceId: "your-server-instance-id",
  adapterId: "sampai-pawn",
  actionId: "mapping.create_object",
  idempotencyKey: "hospital-wall-create-0001",
  payload: {
    operation_id: "hospital-wall-operation-0001",
    object_id: "hospital-wall-01",
    project_id: "hospital",
    model_id: 19377,
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 90 },
    interior_id: 0,
    virtual_world_id: 0
  }
});
```

The action contracts are exported from `src/adapters/pawn/register-pawn-actions.ts`. The adapter handshake advertises exactly `context.player_state`, `mapping.create_object`, `mapping.preview_player_object`, `mapping.clear_player_preview`, `mapping.begin_player_preview_edit`, and `mapping.get_player_preview_edit_result`; the queue checks those capabilities before dispatch.

## Runtime behavior and limitations

- The filterscript sends `adapter.hello`, polls `GET /v1/adapters/tasks/next` every 1.5 seconds, and sends an authenticated heartbeat every 15 seconds.
- `CreatePlayerObject` previews are visible only to the targeted player. The adapter keeps at most one preview per player at a time; a successfully created replacement supersedes the previous preview.
- `mapping.begin_player_preview_edit` opens the native `EditPlayerObject` GUI. `OnPlayerEditObject` captures the final transform or restores the previous accepted transform on cancel.
- `mapping.get_player_preview_edit_result` is a separate task. It reports `ready`, `editing`, `completed`, `cancelled`, or `not_found`; no HTTP task lease is held while the player interacts with the GUI.
- The core-side `MappingPreviewEditOrchestrator` polls with a configured limit, creates an in-memory draft revision only for `completed`, and requests separate approval. It does not publish the draft automatically. See [Mapping Preview Editor](MAPPING_PREVIEW_EDITOR.md).
- Re-preview, clear, disconnect, or filterscript unload invalidates the editor state. The state is in memory only.
- The preview payload includes `player_session_id`, returned by `context.get_player_state`. This prevents a delayed task for a disconnected player from applying to a different person who later receives the same player ID.
- The filterscript destroys tracked previews on `OnPlayerDisconnect` and on filterscript unload. `mapping.clear_player_preview` also requires the matching preview ID and session ID; stale clear tasks cannot delete a newer preview.
- Its UTC timestamps rely on the host clock being correctly configured to UTC. The config flag is an operator assertion, not an automatic timezone detector.
- It handles one task at a time. The result is posted with the lease token returned by the claim endpoint.
- The result callback must confirm HTTP 200 before the adapter polls another task. If result submission is uncertain after a game-side mutation, the adapter pauses instead of processing another task.
- `mapping.create_object` is declared non-idempotent with manual compensation. If its lease expires, the queue will not automatically run it again. An operator must inspect the game state before deciding what to do.
- The task includes `operation_id`, but this starter does not persist a durable deduplication ledger. The current queue and adapter state are in memory.
- The sample accepts only requests with `interior_id: 0` and `virtual_world_id: 0` as a conservative precondition. **This does not scope the created object to those values.** `CreateObject` creates a global server object; it has no player/interior/virtual-world selector. The result therefore reports `scope: "global"` and echoes the requested context under `requested_interior_id` / `requested_virtual_world_id`. Do not use this action when the object must be isolated to a particular interior or virtual world. A future adapter action must use player-specific objects or a runtime/streamer integration with tested context scoping.
- It caps its own create operations at 400 per filterscript lifetime. That counter resets when the filterscript reloads and is not a durable object inventory. The runtime's native object pool can also impose its own limit.
- `runtime_object_id` is the numeric handle returned by `CreateObject`; `object_id` remains the project's logical object identifier.
- It does not implement task lease renewal, mapping inspection/update/delete, object streaming, TextDraw, native-world removal, durable project/revision storage, durable preview/editor state, or undo/redo.
- Keep the filterscript loaded continuously while tasks are in flight. Restarting or reloading during an operation can leave the queue with an unknown outcome; inspect server state before re-enabling mutations.

For a production adapter, add durable task/operation storage, a recoverable mapping-object index, bounded per-tick native work, object catalog validation, runtime-aware interior/virtual-world support, explicit compensation, and integration tests against the exact SA-MP/open.mp runtime and plugin versions being deployed.


## GitHub Actions build

The repository workflow compiles this filterscript as separate SA-MP and open.mp targets using the pinned toolchain in `scripts/build-pawn.sh`. Download the successful workflow artifact `samp-ai-pawn-build` for temporary builds, or use the versioned files attached to a GitHub Release. Compilation is not a substitute for live runtime testing. See [Build and GitHub Releases](RELEASING.md) and [Installation](INSTALLATION.md).
