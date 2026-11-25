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
    session_id: "mock-player-7-session-01",
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

test("mock game adapter scopes previews to a player session and ignores stale clears", () => {
  const { queue, adapter } = createMockHarness();

  adapter.setPlayerState({
    player_id: 7,
    session_id: "mock-player-7-session-01",
    position: { x: 100, y: 200, z: 5 },
    facing: 180,
    interior_id: 3,
    virtual_world_id: 42
  });

  enqueue(queue, "mapping.preview_player_object", {
    preview_id: "hospital-preview-01",
    project_id: "hospital",
    player_id: 7,
    player_session_id: "mock-player-7-session-01",
    model_id: 19377,
    position: { x: 110, y: 210, z: 5 },
    rotation: { x: 0, y: 0, z: 90 }
  }, "preview-create-0001");
  const first = processOne(adapter);
  assert.equal(first.state, "succeeded");
  assert.equal(
    (first.result?.output as { scope: string }).scope,
    "player"
  );
  assert.equal(adapter.getPlayerPreview(7)?.preview_id, "hospital-preview-01");

  // A stale clear cannot remove a newer preview in the same session.
  enqueue(queue, "mapping.preview_player_object", {
    preview_id: "hospital-preview-02",
    project_id: "hospital",
    player_id: 7,
    player_session_id: "mock-player-7-session-01",
    model_id: 19377,
    position: { x: 115, y: 215, z: 5 },
    rotation: { x: 0, y: 0, z: 180 }
  }, "preview-create-0002");
  assert.equal(processOne(adapter).state, "succeeded");

  enqueue(queue, "mapping.clear_player_preview", {
    preview_id: "hospital-preview-01",
    player_id: 7,
    player_session_id: "mock-player-7-session-01"
  }, "preview-stale-clear-0001");
  const staleClear = processOne(adapter);
  assert.equal(staleClear.state, "succeeded");
  assert.equal(
    (staleClear.result?.output as { cleared: boolean }).cleared,
    false
  );
  assert.equal(adapter.getPlayerPreview(7)?.preview_id, "hospital-preview-02");

  // Reusing the player ID in a new session drops the previous session's preview.
  adapter.setPlayerState({
    player_id: 7,
    session_id: "mock-player-7-session-02",
    position: { x: 120, y: 220, z: 5 },
    facing: 90,
    interior_id: 0,
    virtual_world_id: 0
  });
  assert.equal(adapter.getPlayerPreview(7), undefined);

  enqueue(queue, "mapping.preview_player_object", {
    preview_id: "hospital-preview-03",
    project_id: "hospital",
    player_id: 7,
    player_session_id: "mock-player-7-session-02",
    model_id: 19377,
    position: { x: 120, y: 220, z: 5 },
    rotation: { x: 0, y: 0, z: 90 }
  }, "preview-create-0003");
  assert.equal(processOne(adapter).state, "succeeded");

  enqueue(queue, "mapping.clear_player_preview", {
    preview_id: "hospital-preview-02",
    player_id: 7,
    player_session_id: "mock-player-7-session-01"
  }, "preview-old-session-clear-0001");
  const oldSessionClear = processOne(adapter);
  assert.equal(oldSessionClear.state, "succeeded");
  assert.equal(adapter.getPlayerPreview(7)?.preview_id, "hospital-preview-03");

  enqueue(queue, "mapping.clear_player_preview", {
    preview_id: "hospital-preview-03",
    player_id: 7,
    player_session_id: "mock-player-7-session-02"
  }, "preview-clear-0003");
  const cleared = processOne(adapter);
  assert.equal(cleared.state, "succeeded");
  assert.equal((cleared.result?.output as { cleared: boolean }).cleared, true);
  assert.equal(adapter.getPlayerPreview(7), undefined);

  // Disconnect cleanup also destroys any remaining player-scoped preview.
  enqueue(queue, "mapping.preview_player_object", {
    preview_id: "hospital-preview-04",
    project_id: "hospital",
    player_id: 7,
    player_session_id: "mock-player-7-session-02",
    model_id: 19377,
    position: { x: 120, y: 220, z: 5 },
    rotation: { x: 0, y: 0, z: 90 }
  }, "preview-create-0004");
  assert.equal(processOne(adapter).state, "succeeded");
  adapter.disconnectPlayer(7);
  assert.equal(adapter.getPlayerPreview(7), undefined);
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
