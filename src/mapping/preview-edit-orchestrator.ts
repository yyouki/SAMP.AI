import { createHash, randomUUID } from "node:crypto";
import { SampAiError } from "../core/errors.js";
import type {
  ApprovalReceipt,
  ExecutionContext,
  ToolDefinition,
  ToolEffect,
  RiskLevel
} from "../shared/contracts.js";
import { PermissionEngine } from "../security/permission-engine.js";
import { AdapterActionRegistry } from "../adapters/adapter-action-registry.js";
import {
  AdapterTaskQueue
} from "../adapters/adapter-task-queue.js";
import type { AdapterTaskSnapshot } from "../adapters/adapter-task-queue.js";
import { JsonSchemaValidator } from "../validation/json-schema-validator.js";

export interface MappingVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MappingDraftContent {
  readonly draftId: string;
  readonly projectId: string;
  readonly objectId: string;
  readonly modelId: number;
  readonly position: MappingVector3;
  readonly rotation: MappingVector3;
  readonly interiorId: number;
  readonly virtualWorldId: number;
}

export interface MappingDraftRevision extends MappingDraftContent {
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly sourceRequestId: string;
  readonly contentHash: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateMappingDraftRevisionInput {
  readonly sourceRequestId: string;
  readonly createdBy: string;
  readonly parentRevisionId?: string;
  readonly content: MappingDraftContent;
}

export interface MappingDraftRevisionStore {
  createRevision(input: CreateMappingDraftRevisionInput): Promise<MappingDraftRevision>;
  getRevision(revisionId: string): Promise<MappingDraftRevision | undefined>;
}

export interface ApprovalRequestInput {
  /** Must be idempotent for a repeated source request ID. */
  readonly requestId: string;
  readonly toolId: string;
  readonly revisionId: string;
  readonly draftHash: string;
  readonly serverInstanceId: string;
  readonly projectId: string;
  readonly requestedBy: string;
}

export interface ApprovalRequestResult {
  readonly approvalRequestId: string;
}

export interface MappingApprovalRequestPort {
  requestApproval(input: ApprovalRequestInput): Promise<ApprovalRequestResult>;
}

export interface AdapterTaskWaiter {
  waitForTerminalTask(
    queue: AdapterTaskQueue,
    taskId: string,
    serverInstanceId: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<AdapterTaskSnapshot>;
}

export class QueuePollingAdapterTaskWaiter implements AdapterTaskWaiter {
  constructor(private readonly pollIntervalMs = 100) {
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 5000) {
      throw new Error("Task waiter poll interval must be between 10ms and 5000ms.");
    }
  }

  async waitForTerminalTask(
    queue: AdapterTaskQueue,
    taskId: string,
    serverInstanceId: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<AdapterTaskSnapshot> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (signal?.aborted) {
        throw new SampAiError("Waiting for the adapter task was cancelled.", "ORCHESTRATION_CANCELLED");
      }

      const task = queue.getTask(taskId, serverInstanceId);
      if (task.state !== "queued" && task.state !== "leased") {
        return task;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new SampAiError(
          "Timed out waiting for adapter task " + taskId + ".",
          "ADAPTER_TASK_WAIT_TIMEOUT"
        );
      }

      await abortableDelay(Math.min(this.pollIntervalMs, remainingMs), signal);
    }
  }
}

export interface MappingPreviewEditOrchestratorOptions {
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly taskTimeoutMs?: number;
  readonly taskWaiter?: AdapterTaskWaiter;
}

export interface EditPlayerPreviewInput {
  readonly context: ExecutionContext;
  readonly adapterId: string;
  readonly requestId: string;
  readonly previewId: string;
  readonly playerId: number;
  readonly playerSessionId: string;
  readonly draft: MappingDraftContent;
  readonly parentRevisionId?: string;
}

export type EditPlayerPreviewResult =
  | {
      readonly status: "awaiting_approval";
      readonly revision: MappingDraftRevision;
      readonly approvalRequestId: string;
      readonly polls: number;
    }
  | {
      readonly status: "cancelled" | "not_found" | "timed_out";
      readonly previewId: string;
      readonly playerId: number;
      readonly polls: number;
    };

export interface EnqueueApprovedMappingApplyInput {
  readonly context: ExecutionContext;
  readonly adapterId: string;
  readonly revisionId: string;
  readonly approval: ApprovalReceipt;
  readonly operationId: string;
  readonly idempotencyKey: string;
}

const draftContentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    draftId: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" },
    projectId: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" },
    objectId: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" },
    modelId: { type: "integer", minimum: 1, maximum: 65535 },
    position: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number", minimum: -100000, maximum: 100000 },
        y: { type: "number", minimum: -100000, maximum: 100000 },
        z: { type: "number", minimum: -100000, maximum: 100000 }
      },
      required: ["x", "y", "z"]
    },
    rotation: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number", minimum: -100000, maximum: 100000 },
        y: { type: "number", minimum: -100000, maximum: 100000 },
        z: { type: "number", minimum: -100000, maximum: 100000 }
      },
      required: ["x", "y", "z"]
    },
    interiorId: { type: "integer", minimum: 0, maximum: 255 },
    virtualWorldId: { type: "integer", minimum: 0, maximum: 2147483647 }
  },
  required: [
    "draftId", "projectId", "objectId", "modelId",
    "position", "rotation", "interiorId", "virtualWorldId"
  ]
} as const;

const PREVIEW_BEGIN_ACTION = "mapping.begin_player_preview_edit";
const PREVIEW_RESULT_ACTION = "mapping.get_player_preview_edit_result";
const CREATE_OBJECT_ACTION = "mapping.create_object";
export const MAPPING_APPLY_APPROVAL_TOOL_ID = "mapping.apply_draft";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key]))
      .join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

function assertSafeToken(value: string, field: string, min = 8, max = 100): void {
  if (!new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{" + (min - 1) + "," + (max - 1) + "}$").test(value)) {
    throw new SampAiError(field + " must be a safe identifier between " + min + " and " + max + " characters.", "ORCHESTRATION_IDENTIFIER_INVALID");
  }
}

function assertProjectContext(
  context: ExecutionContext,
  serverInstanceId: string,
  projectId: string
): void {
  if (context.serverInstanceId !== serverInstanceId || context.projectId !== projectId) {
    throw new SampAiError(
      "Trusted execution context does not match the requested server and project scope.",
      "ORCHESTRATION_SCOPE_MISMATCH"
    );
  }
}

function createPolicyTool(
  id: string,
  action: ReturnType<AdapterActionRegistry["get"]>,
  effect: ToolEffect,
  risk: RiskLevel,
  requiredPermissions: readonly string[]
): ToolDefinition {
  return {
    id,
    implementationId: id,
    description: action.description,
    effect,
    risk,
    requiredPermissions,
    requiredCapabilities: action.requiredCapabilities,
    inputSchema: action.payloadSchema,
    outputSchema: action.resultSchema,
    timeoutMs: 10_000,
    idempotent: action.idempotent,
    compensation: action.compensation,
    handler: async () => {
      throw new SampAiError("Internal orchestration policy tools cannot be called directly.", "INTERNAL_POLICY_TOOL");
    }
  };
}

function taskOutput(task: AdapterTaskSnapshot): unknown {
  if (task.state !== "succeeded" || task.result?.status !== "succeeded") {
    const code = task.result?.error?.code ??
      (task.state === "expired" ? "ADAPTER_TASK_EXPIRED" : "ADAPTER_TASK_FAILED");
    const message = task.result?.error?.message ??
      ("Adapter task finished in state " + task.state + ".");
    throw new SampAiError(message, code);
  }
  return task.result.output;
}

function isSafeTerminalState(task: AdapterTaskSnapshot): boolean {
  return task.state === "succeeded" ||
    task.state === "partially_succeeded" ||
    task.state === "failed" ||
    task.state === "expired";
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new SampAiError("Waiting was cancelled.", "ORCHESTRATION_CANCELLED"));
  }
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new SampAiError("Waiting was cancelled.", "ORCHESTRATION_CANCELLED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * In-memory reference store. Replace with a durable implementation before
 * using the editor workflow across process restarts or multiple core instances.
 */
export class InMemoryMappingDraftRevisionStore implements MappingDraftRevisionStore {
  private readonly revisions = new Map<string, MappingDraftRevision>();
  private readonly sourceRequests = new Map<string, string>();

  async createRevision(input: CreateMappingDraftRevisionInput): Promise<MappingDraftRevision> {
    const content = structuredClone(input.content);
    const contentHash = createHash("sha256")
      .update(canonicalJson(content), "utf8")
      .digest("hex");
    const priorRevisionId = this.sourceRequests.get(input.sourceRequestId);

    if (priorRevisionId) {
      const prior = this.revisions.get(priorRevisionId);
      if (!prior || prior.contentHash !== contentHash) {
        throw new SampAiError(
          "The same editor request attempted to create a different draft revision.",
          "DRAFT_REVISION_IDEMPOTENCY_CONFLICT"
        );
      }
      return structuredClone(prior);
    }

    const revision: MappingDraftRevision = Object.freeze({
      ...content,
      revisionId: randomUUID(),
      ...(input.parentRevisionId ? { parentRevisionId: input.parentRevisionId } : {}),
      sourceRequestId: input.sourceRequestId,
      contentHash,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString()
    });
    this.revisions.set(revision.revisionId, revision);
    this.sourceRequests.set(input.sourceRequestId, revision.revisionId);
    return structuredClone(revision);
  }

  async getRevision(revisionId: string): Promise<MappingDraftRevision | undefined> {
    const revision = this.revisions.get(revisionId);
    return revision ? structuredClone(revision) : undefined;
  }
}

/**
 * Coordinates private preview editing, draft revision creation, and explicit
 * approval. It never publishes an edited preview by itself.
 */
export class MappingPreviewEditOrchestrator {
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly taskTimeoutMs: number;
  private readonly waiter: AdapterTaskWaiter;
  private readonly requests = new Map<string, { fingerprint: string; promise: Promise<EditPlayerPreviewResult> }>();

  constructor(
    private readonly queue: AdapterTaskQueue,
    private readonly actions: AdapterActionRegistry,
    private readonly schemas: JsonSchemaValidator,
    private readonly permissions: PermissionEngine,
    private readonly revisions: MappingDraftRevisionStore,
    private readonly approvals: MappingApprovalRequestPort,
    options: MappingPreviewEditOrchestratorOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxPolls = options.maxPolls ?? 120;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 15_000;
    this.waiter = options.taskWaiter ?? new QueuePollingAdapterTaskWaiter();

    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 0 || this.pollIntervalMs > 60_000) {
      throw new Error("Editor poll interval must be between 0ms and 60000ms.");
    }
    if (!Number.isInteger(this.maxPolls) || this.maxPolls < 1 || this.maxPolls > 600) {
      throw new Error("Editor maxPolls must be between 1 and 600.");
    }
    if (!Number.isInteger(this.taskTimeoutMs) || this.taskTimeoutMs < 1000 || this.taskTimeoutMs > 120_000) {
      throw new Error("Adapter task timeout must be between 1000ms and 120000ms.");
    }
  }

  editPreview(input: EditPlayerPreviewInput): Promise<EditPlayerPreviewResult> {
    assertSafeToken(input.requestId, "requestId", 8, 80);
    const fingerprint = createHash("sha256")
      .update(canonicalJson({
        serverInstanceId: input.context.serverInstanceId,
        projectId: input.draft.projectId,
        actorId: input.context.actor.id,
        adapterId: input.adapterId,
        previewId: input.previewId,
        playerId: input.playerId,
        playerSessionId: input.playerSessionId,
        draft: input.draft
      }), "utf8")
      .digest("hex");

    const prior = this.requests.get(input.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        return Promise.reject(new SampAiError(
          "requestId was reused for a different editor request.",
          "ORCHESTRATION_IDEMPOTENCY_CONFLICT"
        ));
      }
      return prior.promise;
    }

    const promise = this.runEditPreview(input).catch((error: unknown) => {
      this.requests.delete(input.requestId);
      throw error;
    });
    this.requests.set(input.requestId, { fingerprint, promise });
    return promise;
  }

  private async runEditPreview(input: EditPlayerPreviewInput): Promise<EditPlayerPreviewResult> {
    assertProjectContext(input.context, input.context.serverInstanceId, input.draft.projectId);
    this.schemas.assert(draftContentSchema, input.draft, "mapping draft content");

    const beginAction = this.actions.get(PREVIEW_BEGIN_ACTION);
    const readAction = this.actions.get(PREVIEW_RESULT_ACTION);
    const beginTool = createPolicyTool(
      "mapping.preview.begin_edit",
      beginAction,
      "draft",
      "low",
      ["mapping.edit"]
    );
    const readTool = createPolicyTool(
      "mapping.preview.read_edit_result",
      readAction,
      "read",
      "low",
      ["mapping.edit"]
    );
    await this.permissions.assertAuthorized(beginTool, input.context);
    await this.permissions.assertAuthorized(readTool, input.context);

    const beginPayload = {
      preview_id: input.previewId,
      player_id: input.playerId,
      player_session_id: input.playerSessionId
    };
    this.schemas.assert(beginAction.payloadSchema, beginPayload, "preview editor start payload");

    const beginTask = this.queue.enqueue({
      serverInstanceId: input.context.serverInstanceId,
      adapterId: input.adapterId,
      actionId: PREVIEW_BEGIN_ACTION,
      idempotencyKey: "preview-edit-" + input.requestId + "-start",
      payload: beginPayload
    });
    const beginCompleted = await this.waitForTask(beginTask.taskId, input.context);
    const beginOutput = taskOutput(beginCompleted);
    this.schemas.assert(beginAction.resultSchema, beginOutput, "preview editor start result");
    const beginResult = beginOutput as { readonly preview_id: string; readonly player_id: number; readonly player_session_id: string; readonly started: boolean; readonly scope: string };
    if (
      beginResult.preview_id !== input.previewId ||
      beginResult.player_id !== input.playerId ||
      beginResult.player_session_id !== input.playerSessionId ||
      beginResult.scope !== "player"
    ) {
      throw new SampAiError("Adapter editor-start result did not match the requested preview session.", "PREVIEW_EDITOR_RESULT_SCOPE_MISMATCH");
    }

    for (let poll = 0; poll < this.maxPolls; poll += 1) {
      if (input.context.signal?.aborted) {
        throw new SampAiError("Preview editing was cancelled by the caller.", "ORCHESTRATION_CANCELLED");
      }

      const readPayload = beginPayload;
      const readTask = this.queue.enqueue({
        serverInstanceId: input.context.serverInstanceId,
        adapterId: input.adapterId,
        actionId: PREVIEW_RESULT_ACTION,
        idempotencyKey: "preview-edit-" + input.requestId + "-read-" + (poll + 1),
        payload: readPayload
      });
      const readCompleted = await this.waitForTask(readTask.taskId, input.context);
      const readOutput = taskOutput(readCompleted);
      this.schemas.assert(readAction.resultSchema, readOutput, "preview editor result");
      const result = readOutput as {
        readonly preview_id: string;
        readonly player_id: number;
        readonly player_session_id: string;
        readonly found: boolean;
        readonly status: "ready" | "editing" | "completed" | "cancelled" | "not_found";
        readonly position: MappingVector3;
        readonly rotation: MappingVector3;
        readonly scope: string;
      };

      if (
        result.preview_id !== input.previewId ||
        result.player_id !== input.playerId ||
        result.player_session_id !== input.playerSessionId ||
        result.scope !== "player"
      ) {
        throw new SampAiError("Adapter edit result did not match the requested preview session.", "PREVIEW_EDITOR_RESULT_SCOPE_MISMATCH");
      }

      if (!result.found || result.status === "not_found") {
        return {
          status: "not_found",
          previewId: input.previewId,
          playerId: input.playerId,
          polls: poll + 1
        };
      }

      if (result.status === "cancelled") {
        return {
          status: "cancelled",
          previewId: input.previewId,
          playerId: input.playerId,
          polls: poll + 1
        };
      }

      if (result.status === "completed") {
        const updatedDraft: MappingDraftContent = {
          ...structuredClone(input.draft),
          position: structuredClone(result.position),
          rotation: structuredClone(result.rotation)
        };
        const revision = await this.revisions.createRevision({
          sourceRequestId: input.requestId,
          createdBy: input.context.actor.id,
          ...(input.parentRevisionId ? { parentRevisionId: input.parentRevisionId } : {}),
          content: updatedDraft
        });
        const approvalRequest = await this.approvals.requestApproval({
          requestId: input.requestId,
          toolId: MAPPING_APPLY_APPROVAL_TOOL_ID,
          revisionId: revision.revisionId,
          draftHash: revision.contentHash,
          serverInstanceId: input.context.serverInstanceId,
          projectId: input.draft.projectId,
          requestedBy: input.context.actor.id
        });
        return {
          status: "awaiting_approval",
          revision,
          approvalRequestId: approvalRequest.approvalRequestId,
          polls: poll + 1
        };
      }

      if (poll + 1 < this.maxPolls && this.pollIntervalMs > 0) {
        await abortableDelay(this.pollIntervalMs, input.context.signal);
      }
    }

    return {
      status: "timed_out",
      previewId: input.previewId,
      playerId: input.playerId,
      polls: this.maxPolls
    };
  }

  /**
   * Enqueue a global CreateObject only after verifying an approval receipt
   * bound to the exact stored revision, server, project, and apply tool.
   */
  async enqueueApprovedApply(
    input: EnqueueApprovedMappingApplyInput
  ): Promise<AdapterTaskSnapshot> {
    assertSafeToken(input.operationId, "operationId", 8, 128);
    assertSafeToken(input.idempotencyKey, "idempotencyKey", 8, 128);

    const revision = await this.revisions.getRevision(input.revisionId);
    if (!revision) {
      throw new SampAiError("Mapping draft revision was not found.", "DRAFT_REVISION_NOT_FOUND");
    }
    assertProjectContext(input.context, input.context.serverInstanceId, revision.projectId);

    if (revision.interiorId !== 0 || revision.virtualWorldId !== 0) {
      throw new SampAiError(
        "The Pawn reference adapter creates global objects and currently accepts only interior 0 / virtual world 0.",
        "MAPPING_SCOPE_UNSUPPORTED"
      );
    }

    const createAction = this.actions.get(CREATE_OBJECT_ACTION);
    const applyTool = createPolicyTool(
      MAPPING_APPLY_APPROVAL_TOOL_ID,
      createAction,
      "mutate",
      "high",
      ["mapping.apply"]
    );
    const authorizedContext: ExecutionContext = {
      ...input.context,
      draftHash: revision.contentHash,
      approval: input.approval
    };
    await this.permissions.assertAuthorized(applyTool, authorizedContext);

    const payload = {
      operation_id: input.operationId,
      object_id: revision.objectId,
      project_id: revision.projectId,
      model_id: revision.modelId,
      position: structuredClone(revision.position),
      rotation: structuredClone(revision.rotation),
      interior_id: revision.interiorId,
      virtual_world_id: revision.virtualWorldId
    };
    this.schemas.assert(createAction.payloadSchema, payload, "approved mapping apply payload");

    return this.queue.enqueue({
      serverInstanceId: input.context.serverInstanceId,
      adapterId: input.adapterId,
      actionId: CREATE_OBJECT_ACTION,
      idempotencyKey: input.idempotencyKey,
      payload
    });
  }

  private async waitForTask(taskId: string, context: ExecutionContext): Promise<AdapterTaskSnapshot> {
    const task = await this.waiter.waitForTerminalTask(
      this.queue,
      taskId,
      context.serverInstanceId,
      this.taskTimeoutMs,
      context.signal
    );
    if (!isSafeTerminalState(task)) {
      throw new SampAiError("Adapter task did not reach a terminal state.", "ADAPTER_TASK_NOT_TERMINAL");
    }
    return task;
  }
}
