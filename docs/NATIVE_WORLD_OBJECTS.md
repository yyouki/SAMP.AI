# Native GTA World Objects and Undo/Redo

This document covers a special mapping case: changing objects that are part of the original GTA: San Andreas world, rather than objects created by the server.

## 1. Two different object lifecycles

SAMP.AI must distinguish at least these object sources:

| Source | Meaning | Typical removal |
|---|---|---|
| `native_world` | Original GTA: San Andreas map object | open.mp / SA-MP `RemoveBuildingForPlayer` |
| `server_object` | Object created by the server (static or dynamic) | `DestroyObject` or the relevant streamer API |
| `player_object` | Object created for one player | `DestroyPlayerObject` |
| `preview_object` | Temporary object used only for a review session | Adapter preview cleanup |

The AI must identify the object source before proposing a delete operation. It must never assume that a native map building has a normal server object ID.

## 2. Removing a native GTA object

In open.mp / SA-MP, the standard Pawn native `RemoveBuildingForPlayer` removes a standard San Andreas model for one player within a radius around a supplied position. It accepts a model ID, center coordinates, and radius. A model ID of `-1` can remove all models in the specified radius, which is too broad for normal AI-assisted single-object editing and should require a separate, explicit high-impact workflow.

Important limitations from the open.mp documentation:

- The operation is per-player, not a single global object deletion.
- It matches by model ID and radius; it does not accept a unique native-world object handle.
- There is no useful return value identifying which exact world instances were removed.
- The documentation warns of an approximate limit of 1000 removal lines/objects.
- The documentation warns that removing the same object for a player more than once can crash that player. The adapter must deduplicate directives per client session.
- `GetPlayerBuildingsRemoved`, available in open.mp v1.1.0.2612 and later, reports a count; it does not provide a complete list of removed object identities or transforms.

References:
- [open.mp: RemoveBuildingForPlayer](https://open.mp/docs/scripting/functions/RemoveBuildingForPlayer)
- [open.mp: GetPlayerBuildingsRemoved](https://open.mp/docs/scripting/functions/GetPlayerBuildingsRemoved)

### Safe removal workflow

1. The user selects a native object candidate in a compatible map editor, or the AI finds a candidate in a trusted native-map catalog.
2. The adapter returns the model ID, candidate position, interior / virtual-world context if applicable, and the evidence source.
3. The AI places a private marker at the candidate and shows the requested removal radius.
4. The system checks whether other objects with the same model could be captured by that radius. If the adapter cannot determine this, it labels the result uncertain and requires a visual check.
5. The AI describes the impact and creates a draft.
6. An authorized reviewer approves the exact draft revision.
7. The adapter records a removal directive and applies it at most once per relevant player session.
8. The adapter reports the target scope and per-player execution result.

The AI should prefer the smallest validated radius that reliably selects the desired candidate. It must not silently use model ID `-1` or a large radius for a request to remove one object.

### Server-wide behavior

Because the native removal is per player, "remove this object for everyone" means applying the approved directive once to each current player and ensuring it is applied once to future player sessions as they connect.

The adapter should maintain:
- a persistent approved directive registry;
- a per-player-session applied-directive set;
- a stable directive ID and content hash;
- status for players who were offline or whose execution failed.

Do not blindly replay the entire removal list on every callback. Deduplicate by directive ID and client session, and test reconnect behavior for the supported client/runtime versions.

## 3. Native-world removal is not natively reversible

The documented `RemoveBuildingForPlayer` API has no matching `RestoreBuildingForPlayer` function. Therefore SAMP.AI must **not promise instant, exact undo** for native-world removal.

This differs from a server-created object: a server object can be destroyed and recreated from its stored model and transform, while a native world object is part of the client's original GTA map state.

For a native removal, the undo interface should expose the actual available strategy:

### Strategy A — Reconnect-based restoration

If the player starts a fresh client session and the adapter does not reapply the removal directive, the original GTA world object can be loaded again. This is disruptive and must be presented as a reconnect-required action, not as instant undo. The adapter must remove or disable the relevant persistent directive for that player/session before the next connection.

### Strategy B — Replacement / proxy object

If the model ID and a sufficiently accurate original transform are known, an adapter may create a server object using the same model as a visual replacement. This is a **proxy**, not a true restoration of the native map object. Collision, LOD, streaming behavior, damage/state, and other engine-specific properties may differ. The UI must label it as an approximate replacement and show a preview before approval.

### Strategy C — Undo unavailable

If neither reconnect restoration nor a sufficiently accurate replacement is supported, the AI must say that native undo is unavailable for the current session. It should keep the removal in history and explain the safest recovery path.

## 4. Redo behavior

Redo depends on which undo strategy was used:

- After reconnect-based restoration, redo can reapply the approved removal directive once in the new client session.
- After proxy restoration, redo can remove the proxy object and ensure the native-removal directive is active for the next applicable client session. Do not send the same removal directive twice to the same client session.
- If undo was unavailable, redo is simply the reapplication of the still-active directive where safe and not already applied.

Every redo must be permission-checked and must verify the directive's current state. Never blindly replay a non-idempotent native removal request.

## 5. Ordinary server-object undo/redo

For objects created and managed by the server, SAMP.AI can provide normal, immediate undo/redo when the adapter supports the required operations.

| Operation | Undo | Redo |
|---|---|---|
| Create server object | Destroy created object | Recreate from stored specification |
| Delete server object | Recreate from saved snapshot | Delete recreated object |
| Move / rotate object | Restore previous transform | Reapply new transform |
| Change material / color | Restore prior material data | Reapply new material data |
| Create preview marker | Remove marker | Recreate marker |
| Remove native GTA object | Reconnect or proxy strategy; otherwise unavailable | Reapply removal safely, subject to per-session deduplication |

Use stable SAMP.AI object IDs in project storage. Runtime object handles can change after reconnects or recreation and must not be used as the sole persistent identity.

## 6. Undo/redo history record

A history item should retain enough information to explain and compensate for an operation:

```json
{
  "history_id": "history_00042",
  "project_id": "city_center",
  "operation_id": "remove_native_0007",
  "object_source": "native_world",
  "operation": "native_object.remove",
  "target": {
    "model_id": 615,
    "center": { "x": 0.0, "y": 0.0, "z": 0.0 },
    "radius": 0.25,
    "provenance": "editor_selected_candidate"
  },
  "scope": {
    "server_instance_id": "server_ls_01",
    "per_player": true
  },
  "approval": {
    "approved_by": "admin_42",
    "draft_hash": "sha256:example"
  },
  "undo": {
    "availability": "reconnect_required",
    "strategy": "reconnect_without_reapplying_directive"
  },
  "status": "applied"
}
```

The values above are illustrative, not a real map object record.

History should also record whether the action was applied to all online players, only selected players, or future sessions. For partial failure, show exactly which sessions succeeded or failed.

## 7. Required permissions

Suggested permissions:
- `mapping.native.inspect`
- `mapping.native.mark`
- `mapping.native.remove`
- `mapping.native.restore_proxy`
- `mapping.native.manage_directives`
- `mapping.native.approve`

Native-world changes should have their own approval permission. Permission to edit normal mapping must not automatically grant permission to remove original GTA map content.

## 8. Adapter capability contract

An adapter may advertise capabilities such as:

- `world.default_objects.remove_per_player`
- `world.default_objects.removed_count`
- `world.default_objects.catalog_query` (only when a trusted catalog is installed)
- `world.default_objects.private_markers`
- `world.default_objects.replacement_objects`
- `world.default_objects.session_restore` (only if the adapter has a tested reconnect-based workflow)

Do not advertise `world.default_objects.native_restore` unless the runtime provides a genuine native inverse operation and it has been verified.

## 9. Tests and acceptance criteria

- Removing one candidate does not unintentionally target nearby instances of the same model.
- A broad radius or model ID `-1` requires explicit high-impact confirmation.
- A directive is not sent twice to the same client session.
- Current online players and future connections receive the intended approved state exactly once.
- Offline players and failed applications are visible in the operation report.
- The AI distinguishes native-world objects from server-created and player objects.
- Undo UI correctly reports reconnect-required, proxy replacement, or unavailable.
- A proxy replacement is visibly labelled as approximate.
- Revisions and audit history preserve approver, scope, and the exact directive.
