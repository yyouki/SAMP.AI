# Mock Game Adapter

The Mock Game Adapter is a deterministic in-memory runtime for testing the adapter contract without connecting to SA-MP or open.mp. It uses the production-shaped `AdapterActionRegistry` and `AdapterTaskQueue` interfaces, claims leased tasks, executes a supported action, and submits a result through the queue's schema validation.

## What it simulates

| Action | Behavior |
|---|---|
| `context.get_player_state` | Read a seeded player's position, facing, interior, virtual world, and connection session. |
| `mapping.preview_player_object` / `mapping.clear_player_preview` | Create and clear one session-bound private preview per player. |
| `mapping.begin_player_preview_edit` / `mapping.get_player_preview_edit_result` | Simulate the native preview editor lifecycle and retrieve its result without opening a GUI. |
| `anchor.create` / `anchor.list` | Store and list project anchors. |
| `marker.create` / `marker.remove` | Create and remove temporary review markers. |
| `mapping.create_object`, `mapping.update_object`, `mapping.delete_object` | Manage server-created mapping objects in a project. |
| `mapping.inspect` | Return a bounded list of project objects. |
| `world.default_object.remove` | Record a per-player, per-session native-world removal directive as a simulation only. |

The native-world action does **not** remove a GTA world object. Its result contains `simulated: true` and `undo_strategy: reconnect_required` to prevent a test result from being confused with a real runtime operation.

## Minimal setup

```ts
import {
  AdapterActionRegistry,
  AdapterRegistry,
  AdapterTaskQueue,
  JsonSchemaValidator,
  MockGameAdapter,
  ProtocolValidator,
  createDefaultSchemaValidator,
  registerMockGameActions,
  registerMockGameAdapter
} from "../src/index.js";

const serverInstanceId = "local-test-server";
const adapterId = "sampai-mock";

const adapters = new AdapterRegistry(
  new ProtocolValidator(createDefaultSchemaValidator())
);
registerMockGameAdapter(adapters, serverInstanceId, adapterId);

const actions = new AdapterActionRegistry();
registerMockGameActions(actions);

const queue = new AdapterTaskQueue(
  adapters,
  actions,
  new JsonSchemaValidator()
);
const mock = new MockGameAdapter(queue, serverInstanceId, adapterId);

// Seed the simulated player context used by context.get_player_state.
mock.setPlayerState({
  player_id: 7,
  session_id: "local-player-7-session-01",
  position: { x: 100, y: 200, z: 5 },
  facing: 180,
  interior_id: 0,
  virtual_world_id: 0
});

// Enqueue a typed action. The queue validates its payload and capabilities.
queue.enqueue({
  serverInstanceId,
  adapterId,
  actionId: "mapping.create_object",
  idempotencyKey: "hospital-object-0001",
  payload: {
    operation_id: "hospital-create-wall-0001",
    project_id: "hospital",
    object_id: "hospital-wall-01",
    model_id: 19377,
    position: { x: 101, y: 201, z: 5 },
    rotation: { x: 0, y: 0, z: 90 },
    interior_id: 0,
    virtual_world_id: 0
  }
});

// Process one task, or use processAvailable(maxTasks) for a bounded batch.
const result = mock.processNext();
console.log(result?.state, mock.getObjects("hospital"));
```

## Idempotency and failure simulation

Every mutating mock action requires an `operation_id`. Replaying the same action ID, operation ID, and payload returns the stored result instead of applying the change again. Reusing an operation ID with a different payload produces `MOCK_OPERATION_CONFLICT`. The adapter's operation ledger is in memory, so it is suitable for deterministic tests but is not a substitute for durable deduplication in a production Pawn adapter.

Tests can inject one failure for the next matching action:

```ts
mock.failNext("mapping.create_object", {
  code: "MOCK_RUNTIME_BUSY",
  message: "The simulated runtime is temporarily busy."
});
```

The next task with that action ID is completed with a failed task result and does not mutate mock state. The adapter can also process a bounded number of FIFO tasks with `processAvailable(maxTasks)`.

## Boundaries

- All player, anchor, marker, object, directive, and operation-ledger state is held in process memory.
- The mock adapter does not connect to a running game server, call Pawn natives, or render markers in-game.
- A simulated native-world removal directive is only recorded. Real removal remains a future adapter responsibility and must preserve player-session scope and documented undo limitations.
- Production adapters must pass the same protocol, schema, capability, authorization, idempotency, and task-result requirements. The mock implementation is a test harness, not a production runtime.


## Private preview editing

The mock adapter exposes the same `mapping.begin_player_preview_edit` and `mapping.get_player_preview_edit_result` actions as the Pawn reference adapter. It models the `ready` → `editing` → `completed` / `cancelled` lifecycle without opening a real GUI.

Tests can simulate the native edit callback through `finishPlayerPreviewEdit`. A completed edit updates only the player-scoped preview transform. A cancelled edit preserves the last accepted transform. Session replacement and disconnect discard both the preview and its transient editor state. None of these actions creates a server-wide object or approves a draft.
