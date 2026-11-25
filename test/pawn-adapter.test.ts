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
      capabilities: ["context.player_state", "mapping.create_object"],
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
    ["context.get_player_state", "mapping.create_object"]
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
  const { actions, schemas } = createPawnActionHarness();
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

  const result = {
    object_id: "hospital-wall-01",
    project_id: "hospital",
    model_id: 19377,
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 90 },
    interior_id: 0,
    virtual_world_id: 0,
    runtime_object_id: 17
  };

  schemas.assert(create.resultSchema, result, "Pawn mapping result");
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
