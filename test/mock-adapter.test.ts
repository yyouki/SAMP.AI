import assert from "node:assert/strict";
import { test } from "node:test";
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

function createMockHarness() {
  const adapters = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  registerMockGameAdapter(adapters, "mock-server", "sampai-mock");

  const actions = new AdapterActionRegistry();
  registerMockGameActions(actions);

  const queue = new AdapterTaskQueue(
    adapters,
    actions,
    new JsonSchemaValidator()
  );
  const adapter = new MockGameAdapter(queue, "mock-server", "sampai-mock");

  return { queue, adapter };
}

function enqueue(
  queue: AdapterTaskQueue,
  actionId: string,
  payload: unknown,
  idempotencyKey: string
) {
  return queue.enqueue({
    serverInstanceId: "mock-server",
    adapterId: "sampai-mock",
    actionId,
    payload,
    idempotencyKey
  });
}

function processOne(adapter: MockGameAdapter) {
  const result = adapter.processNext();
  assert.ok(result, "expected a queued task to be processed");
  return result;
}

test("mock game adapter creates, inspects, updates, and deletes mapping objects", () => {
  const { queue, adapter } = createMockHarness();
  const createPayload = {
    operation_id: "object-create-operation-001",
    project_id: "hospital",
    object_id: "hospital-wall-01",
    model_id: 19377,
    position: { x: 10, y: 20, z: 3 },
    rotation: { x: 0, y: 0, z: 90 },
    interior_id: 0,
    virtual_world_id: 0
  };

  enqueue(queue, "mapping.create_object", createPayload, "mapping-create-0001");
  const created = processOne(adapter);
  assert.equal(created.state, "succeeded");
  assert.equal(adapter.getObjects("hospital").length, 1);

  // A second queue item with the same operation_id must return the cached result.
  enqueue(queue, "mapping.create_object", createPayload, "mapping-create-0002");
  const replayed = processOne(adapter);
  assert.equal(replayed.state, "succeeded");
  assert.deepEqual(replayed.result?.output, created.result?.output);
  assert.equal(adapter.getObjects("hospital").length, 1);

  enqueue(queue, "mapping.update_object", {
    operation_id: "object-update-operation-001",
    project_id: "hospital",
    object_id: "hospital-wall-01",
    position: { x: 12, y: 20, z: 3 }
  }, "mapping-update-0001");
  const updated = processOne(adapter);
  assert.equal(updated.state, "succeeded");
  assert.deepEqual(
    (updated.result?.output as { position: unknown }).position,
    { x: 12, y: 20, z: 3 }
  );

  enqueue(queue, "mapping.inspect", {
    project_id: "hospital",
    max_objects: 10
  }, "mapping-inspect-0001");
  const inspected = processOne(adapter);
  assert.equal(inspected.state, "succeeded");
  assert.equal(
    (inspected.result?.output as { objects: unknown[] }).objects.length,
    1
  );

  enqueue(queue, "mapping.delete_object", {
    operation_id: "object-delete-operation-001",
    project_id: "hospital",
    object_id: "hospital-wall-01"
  }, "mapping-delete-0001");
  const deleted = processOne(adapter);
  assert.equal(deleted.state, "succeeded");
  assert.equal(
    (deleted.result?.output as { removed: boolean }).removed,
    true
  );
  assert.equal(adapter.getObjects("hospital").length, 0);
});

test("mock game adapter simulates player context, anchors, markers, and native directives", () => {
  const { queue, adapter } = createMockHarness();

  adapter.setPlayerState({
    player_id: 7,
    position: { x: 100, y: 200, z: 5 },
    facing: 180,
    interior_id: 3,
    virtual_world_id: 42
  });
  enqueue(queue, "context.get_player_state", { player_id: 7 }, "player-state-0001");
  const player = processOne(adapter);
  assert.equal(player.state, "succeeded");
  assert.equal((player.result?.output as { found: boolean }).found, true);
  assert.equal(
    (player.result?.output as { virtual_world_id: number }).virtual_world_id,
    42
  );

  enqueue(queue, "anchor.create", {
    operation_id: "anchor-create-operation-001",
    anchor_id: "hospital-entry",
    project_id: "hospital",
    position: { x: 100, y: 200, z: 5 },
    rotation: { x: 0, y: 0, z: 180 },
    interior_id: 3,
    virtual_world_id: 42
  }, "anchor-create-0001");
  assert.equal(processOne(adapter).state, "succeeded");
  assert.equal(adapter.getAnchors("hospital").length, 1);

  enqueue(queue, "anchor.list", { project_id: "hospital" }, "anchor-list-0001");
  const anchors = processOne(adapter);
  assert.equal(anchors.state, "succeeded");
  assert.equal((anchors.result?.output as { anchors: unknown[] }).anchors.length, 1);

  enqueue(queue, "marker.create", {
    operation_id: "marker-create-operation-001",
    marker_id: "review-point-01",
    project_id: "hospital",
    position: { x: 101, y: 201, z: 5 },
    color: "#00FF00"
  }, "marker-create-0001");
  assert.equal(processOne(adapter).state, "succeeded");
  assert.equal(adapter.getMarkers("hospital").length, 1);

  enqueue(queue, "marker.remove", {
    operation_id: "marker-remove-operation-001",
    marker_id: "review-point-01",
    project_id: "hospital"
  }, "marker-remove-0001");
  assert.equal(processOne(adapter).state, "succeeded");
  assert.equal(adapter.getMarkers("hospital").length, 0);

  enqueue(queue, "world.default_object.remove", {
    operation_id: "native-remove-operation-001",
    directive_id: "native-wall-session-01",
    player_id: 7,
    session_id: "player-session-007",
    model_id: 1283,
    center: { x: 100, y: 200, z: 5 },
    radius: 15
  }, "native-remove-0001");
  const directive = processOne(adapter);
  assert.equal(directive.state, "succeeded");
  assert.equal(
    (directive.result?.output as { simulated: boolean }).simulated,
    true
  );
  assert.equal(adapter.getNativeRemovalDirectives().length, 1);
  assert.equal(
    adapter.getNativeRemovalDirectives()[0]?.undo_strategy,
    "reconnect_required"
  );
});

test("mock game adapter returns deterministic injected failures as task results", () => {
  const { queue, adapter } = createMockHarness();
  adapter.failNext("mapping.create_object", {
    code: "MOCK_RUNTIME_BUSY",
    message: "The simulated runtime is temporarily busy."
  });

  enqueue(queue, "mapping.create_object", {
    operation_id: "object-failure-operation-001",
    project_id: "hospital",
    object_id: "hospital-wall-failure",
    model_id: 19377,
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0 },
    interior_id: 0,
    virtual_world_id: 0
  }, "mapping-failure-0001");

  const result = processOne(adapter);
  assert.equal(result.state, "failed");
  assert.equal(result.result?.error?.code, "MOCK_RUNTIME_BUSY");
  assert.equal(adapter.getObjects("hospital").length, 0);
});
