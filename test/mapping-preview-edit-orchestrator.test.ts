import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdapterActionRegistry,
  AdapterRegistry,
  AdapterTaskQueue,
  InMemoryMappingDraftRevisionStore,
  JsonSchemaValidator,
  MAPPING_APPLY_APPROVAL_TOOL_ID,
  MappingPreviewEditOrchestrator,
  MockGameAdapter,
  MOCK_GAME_ADAPTER_CAPABILITIES,
  PermissionEngine,
  ProtocolValidator,
  createDefaultSchemaValidator,
  registerMockGameActions,
  registerMockGameAdapter
} from "../src/index.js";
import type {
  AdapterTaskWaiter,
  MappingDraftContent
} from "../src/index.js";
import type { ApprovalReceipt, ExecutionContext } from "../src/shared/contracts.js";

const SERVER_ID = "mapping-editor-server";
const ADAPTER_ID = "sampai-mock";
const PLAYER_ID = 7;
const SESSION_ID = "player-7-session-001";

function createHarness(
  editOutcome: "completed" | "cancelled" | "editing" | "not_found" = "completed"
) {
  const adapters = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  registerMockGameAdapter(adapters, SERVER_ID, ADAPTER_ID);

  const actions = new AdapterActionRegistry();
  registerMockGameActions(actions);
  const queue = new AdapterTaskQueue(adapters, actions, new JsonSchemaValidator());
  const adapter = new MockGameAdapter(queue, SERVER_ID, ADAPTER_ID);

  adapter.setPlayerState({
    player_id: PLAYER_ID,
    session_id: SESSION_ID,
    position: { x: 100, y: 200, z: 5 },
    facing: 180,
    interior_id: 0,
    virtual_world_id: 0
  });

  // The editor must operate on an already-created private preview.
  queue.enqueue({
    serverInstanceId: SERVER_ID,
    adapterId: ADAPTER_ID,
    actionId: "mapping.preview_player_object",
    idempotencyKey: "seed-preview-task-0001",
    payload: {
      preview_id: "preview-hospital-wall-01",
      project_id: "hospital",
      player_id: PLAYER_ID,
      player_session_id: SESSION_ID,
      model_id: 19377,
      position: { x: 101, y: 201, z: 5 },
      rotation: { x: 0, y: 0, z: 90 }
    }
  });
  assert.equal(adapter.processNext()?.state, "succeeded");

  const waiter: AdapterTaskWaiter = {
    async waitForTerminalTask(taskQueue, taskId, serverInstanceId) {
      const before = taskQueue.getTask(taskId, serverInstanceId);
      const processed = adapter.processNext();
      assert.ok(processed, "the mock adapter should process the queued task");
      if (processed.actionId === "mapping.begin_player_preview_edit") {
        if (editOutcome === "completed" || editOutcome === "cancelled") {
          const accepted = adapter.finishPlayerPreviewEdit(
            PLAYER_ID,
            "preview-hospital-wall-01",
            SESSION_ID,
            {
              position: { x: 108.5, y: 204.25, z: 5.5 },
              rotation: { x: 0, y: 0, z: 92 }
            },
            editOutcome === "cancelled"
          );
          assert.equal(accepted, true);
        } else if (editOutcome === "not_found") {
          adapter.disconnectPlayer(PLAYER_ID);
        }
      }
      const after = taskQueue.getTask(taskId, serverInstanceId);
      assert.notEqual(before.state, "succeeded");
      return after;
    }
  };

  const revisionStore = new InMemoryMappingDraftRevisionStore();
  const approvalRequests: Array<{
    requestId: string;
    toolId: string;
    revisionId: string;
    draftHash: string;
    serverInstanceId: string;
    projectId: string;
    requestedBy: string;
  }> = [];
  const approvalPort = {
    async requestApproval(input: (typeof approvalRequests)[number]) {
      approvalRequests.push(input);
      return { approvalRequestId: "approval-request-0001" };
    }
  };

  const verifiedApprovals: ApprovalReceipt[] = [];
  const permissionEngine = new PermissionEngine({
    async verify(receipt, target) {
      verifiedApprovals.push(receipt);
      return receipt.toolId === MAPPING_APPLY_APPROVAL_TOOL_ID &&
        receipt.draftHash === target.draftHash &&
        receipt.serverInstanceId === target.serverInstanceId &&
        receipt.projectId === target.projectId;
    }
  });

  const orchestrator = new MappingPreviewEditOrchestrator(
    queue,
    actions,
    new JsonSchemaValidator(),
    permissionEngine,
    revisionStore,
    approvalPort,
    {
      pollIntervalMs: 0,
      maxPolls: 2,
      taskTimeoutMs: 1000,
      taskWaiter: waiter
    }
  );

  const context: ExecutionContext = {
    actor: {
      id: "admin-reviewer-01",
      permissions: ["mapping.edit", "mapping.apply"]
    },
    serverInstanceId: SERVER_ID,
    projectId: "hospital",
    adapterCapabilities: [...MOCK_GAME_ADAPTER_CAPABILITIES],
    autonomy: "apply_with_approval"
  };

  const draft: MappingDraftContent = {
    draftId: "hospital-draft-01",
    projectId: "hospital",
    objectId: "hospital-wall-01",
    modelId: 19377,
    position: { x: 101, y: 201, z: 5 },
    rotation: { x: 0, y: 0, z: 90 },
    interiorId: 0,
    virtualWorldId: 0
  };

  return {
    adapter,
    queue,
    orchestrator,
    revisionStore,
    approvalRequests,
    verifiedApprovals,
    context,
    draft
  };
}

function createApproval(
  context: ExecutionContext,
  draftHash: string
): ApprovalReceipt {
  return {
    approvalId: "approval-receipt-0001",
    approvedBy: "second-admin-02",
    toolId: MAPPING_APPLY_APPROVAL_TOOL_ID,
    draftHash,
    serverInstanceId: context.serverInstanceId,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    issuedAt: new Date().toISOString(),
    signature: "test-signature-from-approval-service"
  };
}

test("preview editor creates a revised draft, requests approval, and only then queues global apply", async () => {
  const harness = createHarness();
  const result = await harness.orchestrator.editPreview({
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-request-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: harness.draft,
    parentRevisionId: "hospital-revision-0001"
  });

  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;
  assert.deepEqual(result.revision.position, { x: 108.5, y: 204.25, z: 5.5 });
  assert.deepEqual(result.revision.rotation, { x: 0, y: 0, z: 92 });
  assert.equal(result.revision.parentRevisionId, "hospital-revision-0001");
  assert.equal(result.approvalRequestId, "approval-request-0001");
  assert.equal(harness.approvalRequests.length, 1);
  assert.equal(harness.approvalRequests[0]?.draftHash, result.revision.contentHash);

  // A completed preview edit is not automatically applied to the global world.
  assert.equal(harness.adapter.getObjects("hospital").length, 0);

  const applyTask = await harness.orchestrator.enqueueApprovedApply({
    context: harness.context,
    adapterId: ADAPTER_ID,
    revisionId: result.revision.revisionId,
    approval: createApproval(harness.context, result.revision.contentHash),
    operationId: "hospital-wall-apply-op-0001",
    idempotencyKey: "hospital-wall-apply-key-0001"
  });
  assert.equal(applyTask.state, "queued");
  assert.equal(harness.adapter.getObjects("hospital").length, 0);

  const applied = harness.adapter.processNext();
  assert.equal(applied?.state, "succeeded");
  assert.deepEqual(
    harness.adapter.getObjects("hospital")[0]?.position,
    { x: 108.5, y: 204.25, z: 5.5 }
  );
  assert.equal(harness.verifiedApprovals.length, 1);
});

test("cancelled preview edits never create a draft revision or approval request", async () => {
  const harness = createHarness("cancelled");
  const result = await harness.orchestrator.editPreview({
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-cancel-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: harness.draft
  });

  assert.equal(result.status, "cancelled");
  assert.equal(harness.approvalRequests.length, 0);
  assert.equal(harness.adapter.getObjects("hospital").length, 0);
});

test("preview edit polling is bounded and timeout cannot create a revision", async () => {
  const harness = createHarness("editing");
  const result = await harness.orchestrator.editPreview({
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-timeout-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: harness.draft
  });

  assert.equal(result.status, "timed_out");
  if (result.status === "timed_out") assert.equal(result.polls, 2);
  assert.equal(harness.approvalRequests.length, 0);
  assert.equal(harness.adapter.getObjects("hospital").length, 0);
});

test("stale player sessions return not_found and do not request approval", async () => {
  const harness = createHarness("not_found");
  const result = await harness.orchestrator.editPreview({
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-stale-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: harness.draft
  });

  assert.equal(result.status, "not_found");
  assert.equal(harness.approvalRequests.length, 0);
});

test("preview editing requires a trusted mapping.edit permission before enqueue", async () => {
  const harness = createHarness();
  const deniedContext: ExecutionContext = {
    ...harness.context,
    actor: { id: "readonly-user", permissions: ["mapping.view"] }
  };

  await assert.rejects(
    harness.orchestrator.editPreview({
      context: deniedContext,
      adapterId: ADAPTER_ID,
      requestId: "preview-edit-denied-0001",
      previewId: "preview-hospital-wall-01",
      playerId: PLAYER_ID,
      playerSessionId: SESSION_ID,
      draft: harness.draft
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PERMISSION_DENIED"
  );
  assert.equal(harness.approvalRequests.length, 0);
});

test("global apply rejects an approval receipt bound to another draft hash", async () => {
  const harness = createHarness();
  const result = await harness.orchestrator.editPreview({
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-bad-approval-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: harness.draft
  });
  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;

  await assert.rejects(
    harness.orchestrator.enqueueApprovedApply({
      context: harness.context,
      adapterId: ADAPTER_ID,
      revisionId: result.revision.revisionId,
      approval: createApproval(harness.context, "different-draft-hash"),
      operationId: "hospital-wall-invalid-apply-0001",
      idempotencyKey: "hospital-wall-invalid-apply-key-0001"
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "APPROVAL_INVALID"
  );
  assert.equal(harness.adapter.getObjects("hospital").length, 0);
});

test("Pawn global apply refuses a revision that requires non-default world scoping", async () => {
  const harness = createHarness();
  const scopedDraft: MappingDraftContent = {
    ...harness.draft,
    interiorId: 3,
    virtualWorldId: 42
  };
  const result = await harness.orchestrator.editPreview({
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-scoped-draft-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: scopedDraft
  });
  assert.equal(result.status, "awaiting_approval");
  if (result.status !== "awaiting_approval") return;

  await assert.rejects(
    harness.orchestrator.enqueueApprovedApply({
      context: harness.context,
      adapterId: ADAPTER_ID,
      revisionId: result.revision.revisionId,
      approval: createApproval(harness.context, result.revision.contentHash),
      operationId: "hospital-wall-interior-apply-0001",
      idempotencyKey: "hospital-wall-interior-apply-key-0001"
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "MAPPING_SCOPE_UNSUPPORTED"
  );
  assert.equal(harness.adapter.getObjects("hospital").length, 0);
});

test("editor request IDs cannot be reused for a different payload", async () => {
  const harness = createHarness();
  const input = {
    context: harness.context,
    adapterId: ADAPTER_ID,
    requestId: "preview-edit-idempotency-0001",
    previewId: "preview-hospital-wall-01",
    playerId: PLAYER_ID,
    playerSessionId: SESSION_ID,
    draft: harness.draft
  };
  const first = await harness.orchestrator.editPreview(input);
  assert.equal(first.status, "awaiting_approval");

  await assert.rejects(
    harness.orchestrator.editPreview({
      ...input,
      draft: { ...harness.draft, modelId: 19378 }
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ORCHESTRATION_IDEMPOTENCY_CONFLICT"
  );
});
