# Universal Protocol (Draft)

**Status:** initial design draft. Breaking changes are expected before the first stable release.

The protocol separates the SAMP.AI Core from game-server runtimes. It is language-neutral and uses JSON in the first implementation. A future binary transport can reuse the same logical message model.

## 1. Principles

- Every message includes a protocol version, message ID, server instance ID, and timestamp.
- Requests and responses are correlated by `request_id`.
- Mutating requests use an `idempotency_key` to prevent duplicate execution after retries.
- Adapters advertise capabilities and limits; the core never assumes a function exists.
- Coordinates include provenance and context, not only x/y/z.
- Drafts are immutable once submitted for approval. Any edit creates a new revision.
- Server execution is represented as typed operations, never arbitrary source code.
- Object source is explicit: native GTA world object, server-created object, player object, or temporary preview object.

## 2. Message envelope

Example request:

```json
{
  "protocol": "sampai/0.1",
  "message_id": "msg_01JEXAMPLE",
  "type": "request",
  "request_id": "req_01JEXAMPLE",
  "server_instance_id": "server_ls_01",
  "timestamp": "2026-11-23T14:00:00Z",
  "actor": {
    "id": "account_42",
    "kind": "admin"
  },
  "action": "context.get_player_state",
  "payload": {
    "player_id": 12
  }
}
```

Example response:

```json
{
  "protocol": "sampai/0.1",
  "message_id": "msg_01JEXAMPLE_RESPONSE",
  "type": "response",
  "request_id": "req_01JEXAMPLE",
  "server_instance_id": "server_ls_01",
  "timestamp": "2026-11-23T14:00:00Z",
  "ok": true,
  "result": {
    "player_id": 12,
    "position": {
      "frame": "world",
      "x": 1481.2,
      "y": -1724.6,
      "z": 13.5,
      "rotation": { "x": 0, "y": 0, "z": 90 },
      "interior_id": 0,
      "virtual_world_id": 0,
      "source": "server_player_position",
      "precision": "measured"
    }
  }
}
```

Errors should use stable codes such as `INVALID_SCHEMA`, `UNSUPPORTED_CAPABILITY`, `PERMISSION_DENIED`, `APPROVAL_REQUIRED`, `RATE_LIMITED`, `CONFLICT`, and `EXECUTION_FAILED`. Include a human-readable message and safe details; never return secrets.

## 3. Coordinate value

A coordinate is a structured value:

```json
{
  "frame": "world",
  "position": { "x": 1481.2, "y": -1724.6, "z": 13.5 },
  "rotation": { "x": 0.0, "y": 0.0, "z": 90.0 },
  "context": {
    "interior_id": 0,
    "virtual_world_id": 0
  },
  "provenance": {
    "source": "user_selected_point",
    "adapter_method": "editor.select_point",
    "captured_at": "2026-11-23T14:00:00Z",
    "confidence": "high"
  }
}
```

Allowed provenance sources should include:
- `user_supplied`
- `user_selected_point`
- `editor_surface_hit`
- `player_position`
- `camera_projection_estimate`
- `derived_from_anchor`
- `catalog_or_map_reference`

Confidence is descriptive, not a mathematical guarantee. The adapter must not report `editor_surface_hit` unless it actually performed a trusted surface query.

For local coordinates, use `frame: "local"` and require an `anchor_id` or a complete transform. Do not silently mix local and world coordinates.

## 4. Capability handshake

When an adapter connects, it sends an `adapter.hello` message with runtime metadata and capabilities.

Example:

```json
{
  "protocol": "sampai/0.1",
  "message_id": "hello_001",
  "type": "event",
  "server_instance_id": "server_ls_01",
  "timestamp": "2026-11-23T14:00:00Z",
  "event": "adapter.hello",
  "payload": {
    "adapter": {
      "name": "sampai-pawn",
      "version": "0.1.0",
      "runtime": "open.mp",
      "runtime_version": "reported-by-adapter"
    },
    "capabilities": [
      "context.player_position",
      "context.player_facing",
      "context.interior_virtual_world",
      "mapping.create_object",
      "mapping.delete_object",
      "mapping.create_marker",
      "mapping.remove_marker",
      "world.default_objects.remove_per_player",
      "world.default_objects.removed_count",
      "textdraw.create",
      "textdraw.destroy",
      "project.batch_apply"
    ],
    "limits": {
      "max_operations_per_batch": 20,
      "max_objects_per_project": 1000
    }
  }
}
```

Capability names are examples. The final registry should be maintained centrally and versioned. Optional native-world capabilities may include `world.default_objects.catalog_query`, `world.default_objects.private_markers`, and `world.default_objects.replacement_objects`. Do not advertise `world.default_objects.native_restore` unless the runtime has a tested genuine native inverse operation.

## 5. Core actions

Initial action groups:

| Group | Example actions |
|---|---|
| Context | `context.get_player_state`, `context.get_camera_ray`, `context.get_surface_hit`, `context.get_object` |
| Anchors | `anchor.create`, `anchor.list`, `anchor.update`, `anchor.delete` |
| Markers | `marker.create`, `marker.update`, `marker.remove`, `marker.clear_session` |
| Mapping | `mapping.create_object`, `mapping.update_object`, `mapping.delete_object`, `mapping.inspect` |
| Native world | `world.default_object.query`, `world.default_object.mark`, `world.default_object.remove`, `world.default_object.restore_proxy` |
| TextDraw | `textdraw.create`, `textdraw.update`, `textdraw.destroy`, `textdraw.preview` |
| Projects | `project.create`, `project.get`, `project.save_revision`, `project.restore_revision` |
| Execution | `plan.validate`, `plan.preview`, `plan.apply`, `plan.cancel` |

A `restore_proxy` operation creates an explicitly labelled server-object substitute; it does not restore the original native GTA object. There is no generic `world.default_object.restore` action in the initial protocol because the documented open.mp / SA-MP removal API has no matching native restore operation. Native removal undo may require a fresh client session without replaying the directive, a proxy replacement, or may be unavailable. See [Native World Objects and Undo/Redo](NATIVE_WORLD_OBJECTS.md).

An action name is only a protocol identifier. It must still pass authentication, authorization, schema validation, capability checks, resource limits, and approval policy.

## 6. Draft operation example

A mapping draft contains operations with stable local IDs. It is not executable code.

```json
{
  "schema_version": "0.1",
  "draft_id": "draft_hospital_001",
  "project_id": "hospital_ls",
  "revision": 3,
  "kind": "mapping",
  "operations": [
    {
      "operation_id": "op_wall_001",
      "type": "object.create",
      "object_source": "server_object",
      "local_id": "wall_north_01",
      "model_id": 19377,
      "transform": {
        "frame": "local",
        "anchor_id": "hospital_anchor",
        "position": { "x": 0.0, "y": 6.0, "z": 1.5 },
        "rotation": { "x": 0.0, "y": 0.0, "z": 0.0 }
      },
      "metadata": {
        "purpose": "north exterior wall"
      }
    }
  ],
  "approval": {
    "required_permission": "mapping.approve",
    "status": "pending"
  }
}
```

A native-world removal draft should use a separate operation type and explicit target scope. It must include model ID, center, radius, candidate provenance, affected player scope, and a declared undo strategy. It must never be represented as an ordinary `object.delete` operation because the native map object has no ordinary server object handle.

The validator must check model availability, finite numeric values, coordinate bounds, transform completeness, duplicate IDs, operation count, and adapter capability support. The example model ID is illustrative and must be checked against a trusted catalog before use.

## 7. Events

Adapters can publish events such as:
- `server.connected`
- `player.editor_session_started`
- `player.anchor_selected`
- `mapping.object_changed`
- `textdraw.changed`
- `project.revision_applied`
- `project.execution_failed`
- `world.default_object.removal_applied`
- `world.default_object.removal_failed`

Events should be scoped to the minimum necessary project/server context. Avoid streaming general player chat or unrelated player activity by default.

## 8. Approval and execution

A plan approval must reference:
- draft ID and revision;
- immutable content hash;
- approver identity;
- permission checked;
- approval timestamp;
- scope of approval (server instance / project).

If the draft changes, the content hash changes and the previous approval is invalid. Applying a plan should return per-operation results and a final status such as `succeeded`, `partially_succeeded`, or `failed`.

For native-world removal, results must be reported per player session because the operation is player-scoped. The adapter must deduplicate approved removal directives for each client session; it must not blindly replay a removal that has already been applied.

## 9. Machine-readable schemas and validation

The initial protocol schemas are stored in:
- `schemas/protocol/message.schema.json` — request, response, and event envelopes.
- `schemas/protocol/adapter-hello.schema.json` — adapter capability handshake.
- `schemas/protocol/coordinate.schema.json` — world/local positions with provenance.

The TypeScript `ProtocolValidator` exposes validation methods for message envelopes, adapter hello events, and coordinates. Adapter implementations should validate inbound and outbound messages at their trust boundary.

The schemas are versioned with the protocol. A schema update must include compatibility notes and tests with valid and invalid fixtures.

## 10. Compatibility

- Protocol versions use `major.minor` semantics.
- A major version may introduce breaking changes.
- A minor version may add optional fields or capabilities.
- Unknown optional fields should be ignored when safe.
- Unknown action types must be rejected, not guessed.
- Adapters must state the version range they support.
