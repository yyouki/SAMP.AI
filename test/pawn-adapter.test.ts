import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdapterActionRegistry,
  AdapterRegistry,
  AdapterTaskQueue,
  JsonSchemaValidator,
  ProtocolValidator,
  createDefaultSchemaValidator,
  registerPawnAdapterActions
} from "../src/index.js";

function createPawnActionHarness() {
  const adapters = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );

  adapters.registerHello({
    protocol: "sampai/0.1",
    message_id: "pawn_adapter_hello_001",
    type: "event",
    server_instance_id: "pawn-server",
    timestamp: "2026-11-25T00:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: {
        name: "sampai-pawn",
        version: "0.1.0",
        runtime: "open.mp"
      },
      capabilities: [
        "context.player_state",
        "mapping.create_object",
        "mapping.preview_player_object",
        "mapping.clear_player_preview",
        "mapping.begin_player_preview_edit",
        "mapping.get_player_preview_edit_result"
      ],
      limits: {
        max_operations_per_batch: 1,
        max_objects_per_project: 400
      }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "pawn-server"
  });

  const actions = new AdapterActionRegistry();
  registerPawnAdapterActions(actions);

  const schemas = new JsonSchemaValidator();
  const queue = new AdapterTaskQueue(adapters, actions, schemas);

  return { actions, schemas, queue };
}

test("Pawn adapter registers only its implemented read and mapping actions", () => {
  const { actions } = createPawnActionHarness();

  assert.deepEqual(
    actions.list().map((entry) => entry.id),
    ["context.get_player_state", "mapping.create_object", "mapping.preview_player_object", "mapping.clear_player_preview", "mapping.begin_player_preview_edit", "mapping.get_player_preview_edit_result"]
  );

  assert.equal(actions.get("context.get_player_state").effect, "read");
  assert.equal(actions.get("context.get_player_state").idempotent, true);

  const create = actions.get("mapping.create_object");
  assert.equal(create.effect, "mutate");
  assert.equal(create.idempotent, false);
  assert.equal(create.compensation, "manual");
  assert.deepEqual(create.requiredCapabilities, ["mapping.create_object"]);
});

test("Pawn mapping action schema accepts a supported global object task and result", () => {
  const { actions, schemas, queue } = createPawnActionHarness();
  const create = actions.get("mapping.create_object");

  const payload = {
    operation_id: "hospital-wall-create-001",
    object_id: "hospital-wall-01",
    project_id: "hospital",
    model_id: 19377,
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 90 },
    interior_id: 0,
    virtual_world_id: 0
  };

  schemas.assert(create.payloadSchema, payload, "Pawn mapping payload");
  assert.throws(
    () => schemas.assert(create.payloadSchema, {
      ...payload,
      virtual_world_id: 1
    }, "unsupported Pawn mapping context"),
    /Invalid unsupported Pawn mapping context/
  );

  const result = {
    object_id: "hospital-wall-01",
    project_id: "hospital",
    model_id: 19377,
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 90 },
    scope: "global",
    requested_interior_id: 0,
    requested_virtual_world_id: 0,
    runtime_object_id: 17
  };

  schemas.assert(create.resultSchema, result, "Pawn mapping result");

  // Verify the queue accepts the exact result shape emitted by the Pawn script.
  const queued = queue.enqueue({
    serverInstanceId: "pawn-server",
    adapterId: "sampai-pawn",
    actionId: "mapping.create_object",
    idempotencyKey: "pawn-mapping-result-0001",
    payload
  });
  const lease = queue.claimNext("pawn-server", "sampai-pawn");
  assert.ok(lease);
  assert.equal(lease.taskId, queued.taskId);

  const completed = queue.complete(
    "pawn-server",
    "sampai-pawn",
    lease.taskId,
    lease.leaseToken,
    { status: "succeeded", output: result }
  );
  assert.equal(completed.state, "succeeded");
});

test("Pawn player preview is session-bound and can be explicitly cleared", () => {
  const { actions, schemas, queue } = createPawnActionHarness();
  const preview = actions.get("mapping.preview_player_object");
  const clear = actions.get("mapping.clear_player_preview");

  assert.equal(preview.idempotent, false);
  assert.equal(preview.compensation, "undo");
  assert.equal(clear.idempotent, true);

  const previewPayload = {
    preview_id: "hospital-wall-preview-01",
    project_id: "hospital",
    player_id: 7,
    player_session_id: "p7_1000_1",
    model_id: 19377,
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 90 }
  };
  schemas.assert(preview.payloadSchema, previewPayload, "Pawn player preview payload");

  const previewResult = {
    ...previewPayload,
    runtime_object_id: 21,
    scope: "player"
  };
  schemas.assert(preview.resultSchema, previewResult, "Pawn player preview result");

  const previewTask = queue.enqueue({
    serverInstanceId: "pawn-server",
    adapterId: "sampai-pawn",
    actionId: preview.id,
    idempotencyKey: "player-preview-0001",
    payload: previewPayload
  });
  const previewLease = queue.claimNext("pawn-server", "sampai-pawn");
  assert.ok(previewLease);
  const completedPreview = queue.complete(
    "pawn-server",
    "sampai-pawn",
    previewLease.taskId,
    previewLease.leaseToken,
    { status: "succeeded", output: previewResult }
  );
  assert.equal(completedPreview.taskId, previewTask.taskId);
  assert.equal(completedPreview.state, "succeeded");

  const clearPayload = {
    preview_id: "hospital-wall-preview-01",
    player_id: 7,
    player_session_id: "p7_1000_1"
  };
  schemas.assert(clear.payloadSchema, clearPayload, "Pawn player preview clear payload");
  const clearResult = {
    ...clearPayload,
    cleared: true,
    scope: "player"
  };
  schemas.assert(clear.resultSchema, clearResult, "Pawn player preview clear result");

  const clearTask = queue.enqueue({
    serverInstanceId: "pawn-server",
    adapterId: "sampai-pawn",
    actionId: clear.id,
    idempotencyKey: "player-preview-clear-0001",
    payload: clearPayload
  });
  const clearLease = queue.claimNext("pawn-server", "sampai-pawn");
  assert.ok(clearLease);
  const completedClear = queue.complete(
    "pawn-server",
    "sampai-pawn",
    clearLease.taskId,
    clearLease.leaseToken,
    { status: "succeeded", output: clearResult }
  );
  assert.equal(completedClear.taskId, clearTask.taskId);
  assert.equal(completedClear.state, "succeeded");

  assert.throws(
    () => schemas.assert(preview.payloadSchema, {
      ...previewPayload,
      player_session_id: "session with spaces"
    }, "invalid session"),
    /Invalid invalid session/
  );
});


test("Pawn preview editor starts asynchronously and exposes final or cancelled transforms", () => {
  const { actions, schemas, queue } = createPawnActionHarness();
  const begin = actions.get("mapping.begin_player_preview_edit");
  const read = actions.get("mapping.get_player_preview_edit_result");
  assert.equal(begin.effect, "mutate");
  assert.equal(begin.idempotent, true);
  assert.equal(read.effect, "read");
  assert.equal(read.idempotent, true);

  const payload = {
    preview_id: "hospital-preview-edit-01",
    player_id: 7,
    player_session_id: "p7_2000_1"
  };
  schemas.assert(begin.payloadSchema, payload, "Pawn preview edit start payload");
  schemas.assert(read.payloadSchema, payload, "Pawn preview edit state payload");

  const beginResult = { ...payload, started: true, scope: "player" };
  schemas.assert(begin.resultSchema, beginResult, "Pawn preview edit start result");
  const beginTask = queue.enqueue({
    serverInstanceId: "pawn-server",
    adapterId: "sampai-pawn",
    actionId: begin.id,
    idempotencyKey: "preview-edit-start-0001",
    payload
  });
  const beginLease = queue.claimNext("pawn-server", "sampai-pawn");
  assert.ok(beginLease);
  const beginCompleted = queue.complete(
    "pawn-server",
    "sampai-pawn",
    beginLease.taskId,
    beginLease.leaseToken,
    { status: "succeeded", output: beginResult }
  );
  assert.equal(beginCompleted.taskId, beginTask.taskId);
  assert.equal(beginCompleted.state, "succeeded");

  const readResult = {
    ...payload,
    found: true,
    status: "completed",
    position: { x: 105, y: 202, z: 5 },
    rotation: { x: 0, y: 0, z: 92 },
    scope: "player"
  };
  schemas.assert(read.resultSchema, readResult, "Pawn preview edit result");
  assert.throws(
    () => schemas.assert(read.resultSchema, {
      ...readResult,
      status: "applied"
    }, "invalid preview edit status"),
    /Invalid invalid preview edit status/
  );
});

test("Pawn context action and mapping tasks can be enqueued only for advertised capabilities", () => {
  const { actions, queue } = createPawnActionHarness();

  const contextTask = queue.enqueue({
    serverInstanceId: "pawn-server",
    adapterId: "sampai-pawn",
    actionId: "context.get_player_state",
    idempotencyKey: "player-state-0001",
    payload: { player_id: 7 }
  });
  assert.equal(contextTask.state, "queued");

  const mappingTask = queue.enqueue({
    serverInstanceId: "pawn-server",
    adapterId: "sampai-pawn",
    actionId: "mapping.create_object",
    idempotencyKey: "mapping-create-0001",
    payload: {
      operation_id: "hospital-wall-create-002",
      object_id: "hospital-wall-02",
      project_id: "hospital",
      model_id: 19377,
      position: { x: 100, y: 200, z: 5 },
      rotation: { x: 0, y: 0, z: 90 },
      interior_id: 0,
      virtual_world_id: 0
    }
  });
  assert.equal(mappingTask.state, "queued");

  const original = actions.get("mapping.create_object");
  assert.throws(() => {
    const missingCapabilityAdapter = new AdapterRegistry(
      new ProtocolValidator(createDefaultSchemaValidator())
    );
    missingCapabilityAdapter.registerHello({
      protocol: "sampai/0.1",
      message_id: "pawn_missing_capability",
      type: "event",
      server_instance_id: "pawn-server-no-mapping",
      timestamp: "2026-11-25T00:00:00Z",
      event: "adapter.hello",
      payload: {
        adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
        capabilities: ["context.player_state"],
        limits: { max_operations_per_batch: 1, max_objects_per_project: 400 }
      }
    }, {
      adapterId: "sampai-pawn",
      serverInstanceId: "pawn-server-no-mapping"
    });

    const blockedQueue = new AdapterTaskQueue(
      missingCapabilityAdapter,
      actions,
      new JsonSchemaValidator()
    );
    blockedQueue.enqueue({
      serverInstanceId: "pawn-server-no-mapping",
      adapterId: "sampai-pawn",
      actionId: original.id,
      idempotencyKey: "mapping-denied-0001",
      payload: {
        operation_id: "hospital-wall-create-003",
        object_id: "hospital-wall-03",
        project_id: "hospital",
        model_id: 19377,
        position: { x: 100, y: 200, z: 5 },
        rotation: { x: 0, y: 0, z: 90 },
        interior_id: 0,
        virtual_world_id: 0
      }
    });
  }, /does not provide: mapping.create_object/);
});
