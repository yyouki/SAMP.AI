# Mapping Preview Editor Orchestration

## Purpose

`MappingPreviewEditOrchestrator` connects the Pawn preview editor to the core draft and approval workflow. It deliberately separates editing from publishing:

1. Verify the trusted actor has `mapping.edit` and the adapter advertises the editor capability.
2. Enqueue `mapping.begin_player_preview_edit` for the exact `preview_id`, `player_id`, and `player_session_id`.
3. Poll `mapping.get_player_preview_edit_result` using short adapter tasks and a bounded attempt/time policy.
4. Create a new draft revision only when the result status is `completed`.
5. Send an approval request bound to the revision hash, project, server, and `mapping.apply_draft` tool ID.
6. Later, accept a separately supplied approval receipt, verify it through `PermissionEngine`, and enqueue `mapping.create_object`.

The editor callback never creates a server-wide object. The orchestrator's edit method never applies a draft.

## Important contracts

The caller must provide an `ExecutionContext` created from trusted server-side authentication and permission resolvers. Do not build actor permissions, autonomy, or adapter capabilities from model output or from a client-provided JSON field.

The editor path requires the `mapping.edit` permission. The apply path requires `mapping.apply` and a verified `ApprovalReceipt` whose `toolId` is `mapping.apply_draft` and whose `draftHash`, `serverInstanceId`, and `projectId` match the stored revision and execution context.

The Pawn adapter's current `mapping.create_object` action creates a global object and accepts only `interior_id: 0` and `virtual_world_id: 0`. `enqueueApprovedApply` rejects other values before queueing.

## Bounded polling and outcomes

Constructor defaults are:

- `pollIntervalMs`: 1000
- `maxPolls`: 120
- `taskTimeoutMs`: 15000

Each adapter task has its own wait timeout. The editor polling loop is bounded by `maxPolls`; there is no unbounded loop waiting for a player GUI.

`editPreview` returns one of these statuses:

- `awaiting_approval`: a completed edit created a draft revision and an approval request.
- `cancelled`: the player cancelled; no revision or approval request is created.
- `not_found`: the preview or player session no longer matches; no revision or approval request is created.
- `timed_out`: the editor did not reach a terminal state within the configured polling limit; no revision or approval request is created.

The caller should display the approval request to an authorized reviewer. A `completed` edit is only a draft candidate, not an approval.

## Storage and host integration

The constructor takes:

- `AdapterTaskQueue` and `AdapterActionRegistry`.
- `JsonSchemaValidator` and `PermissionEngine`.
- A `MappingDraftRevisionStore`.
- A `MappingApprovalRequestPort`.
- Optional polling/task-wait configuration.

`InMemoryMappingDraftRevisionStore` is provided for tests and local experiments only. Implement `MappingDraftRevisionStore` with durable storage before using this across restarts or multiple backend instances. Implement `MappingApprovalRequestPort` using the application's actual approval UI/notification system. The orchestrator does not invent or sign approval receipts.

The orchestrator deduplicates a repeated `requestId` within one process. This is not durable cross-process idempotency. Production deployments need database-level uniqueness for request IDs, revisions, approvals, and operation IDs.

## Basic call flow

The following illustrates the intended call order. `context` must come from the trusted `ExecutionContextFactory`, and `approvalReceipt` must come from a verified human approval workflow.

```ts
const edit = await orchestrator.editPreview({
  context,
  adapterId: "sampai-pawn",
  requestId: "hospital-edit-request-0001",
  previewId: "hospital-preview-wall-01",
  playerId: 7,
  playerSessionId: currentPlayerSessionId,
  draft: currentDraft,
  parentRevisionId: currentRevisionId
});

if (edit.status === "awaiting_approval") {
  // Display edit.revision and request an explicit approval.
  // Do not enqueue mapping.create_object here.
}

// Later, after the approval service supplies a receipt:
const task = await orchestrator.enqueueApprovedApply({
  context,
  adapterId: "sampai-pawn",
  revisionId: approvedRevisionId,
  approval: approvalReceipt,
  operationId: "hospital-wall-apply-operation-0001",
  idempotencyKey: "hospital-wall-apply-request-0001"
});
```

`enqueueApprovedApply` only adds a task to the queue. The game adapter executes it later and returns a schema-validated result. Unknown outcomes for the non-idempotent Pawn global create action must be inspected manually before retrying.