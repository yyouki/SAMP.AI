import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SampAiError } from "../core/errors.js";
import { AdapterActionRegistry } from "./adapter-action-registry.js";
import { AdapterRegistry } from "./adapter-registry.js";
import { JsonSchemaValidator } from "../validation/json-schema-validator.js";
import type { AdapterActionDefinition } from "./adapter-action-registry.js";

export type AdapterTaskState =
  | "queued"
  | "leased"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "expired";

export interface AdapterTaskResult {
  readonly status: "succeeded" | "partially_succeeded" | "failed";
  readonly output?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface EnqueueAdapterTaskInput {
  readonly serverInstanceId: string;
  readonly adapterId: string;
  readonly actionId: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly ttlMs?: number;
  readonly maxAttempts?: number;
}

export interface AdapterTaskSnapshot {
  readonly taskId: string;
  readonly serverInstanceId: string;
  readonly adapterId: string;
  readonly actionId: string;
  readonly payload: unknown;
  readonly requiredCapabilities: readonly string[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly state: AdapterTaskState;
  readonly result?: AdapterTaskResult;
}

export interface LeasedAdapterTask extends AdapterTaskSnapshot {
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
}

export interface AdapterTaskQueueOptions {
  readonly leaseMs?: number;
  readonly defaultTtlMs?: number;
  readonly maxQueuePerAdapter?: number;
  readonly defaultMaxAttempts?: number;
}

interface TaskRecord {
  readonly taskId: string;
  readonly serverInstanceId: string;
  readonly adapterId: string;
  readonly actionId: string;
  readonly payload: unknown;
  readonly payloadHash: string;
  readonly requiredCapabilities: readonly string[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly maxAttempts: number;
  attempts: number;
  state: AdapterTaskState;
  leaseToken?: string;
  leaseExpiresAt?: string;
  result?: AdapterTaskResult;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map((entry) => canonicalJson(entry)).join(",") + "]";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return "{" + keys.map((key) =>
      JSON.stringify(key) + ":" + canonicalJson(record[key])
    ).join(",") + "}";
  }

  throw new SampAiError(
    "Task payload must contain only JSON-compatible values.",
    "TASK_PAYLOAD_INVALID"
  );
}

export class AdapterTaskQueue {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly idempotency = new Map<string, string>();
  private readonly leaseMs: number;
  private readonly defaultTtlMs: number;
  private readonly maxQueuePerAdapter: number;
  private readonly defaultMaxAttempts: number;

  constructor(
    private readonly adapters: AdapterRegistry,
    private readonly actions: AdapterActionRegistry,
    private readonly schemas: JsonSchemaValidator,
    options: AdapterTaskQueueOptions = {}
  ) {
    this.leaseMs = options.leaseMs ?? 90_000;
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60_000;
    this.maxQueuePerAdapter = options.maxQueuePerAdapter ?? 100;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 3;

    if (!Number.isInteger(this.leaseMs) || this.leaseMs < 1000) {
      throw new Error("Task lease must be at least 1000 milliseconds.");
    }
    if (!Number.isInteger(this.defaultTtlMs) || this.defaultTtlMs < 1000) {
      throw new Error("Task TTL must be at least 1000 milliseconds.");
    }
    if (!Number.isInteger(this.maxQueuePerAdapter) || this.maxQueuePerAdapter < 1) {
      throw new Error("Queue capacity must be a positive integer.");
    }
    if (!Number.isInteger(this.defaultMaxAttempts) || this.defaultMaxAttempts < 1 ||
        this.defaultMaxAttempts > 10) {
      throw new Error("Task attempts must be between 1 and 10.");
    }
  }

  enqueue(input: EnqueueAdapterTaskInput): AdapterTaskSnapshot {
    this.refreshExpired();

    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) {
      throw new SampAiError(
        "Idempotency key must be 8-128 safe characters.",
        "IDEMPOTENCY_KEY_INVALID"
      );
    }

    const action = this.actions.get(input.actionId);
    const adapter = this.adapters.getAdapter(
      input.serverInstanceId,
      input.adapterId
    );

    const missingCapabilities = action.requiredCapabilities.filter(
      (capability) => !adapter.capabilities.includes(capability)
    );

    if (missingCapabilities.length > 0) {
      throw new SampAiError(
        "Target adapter does not provide: " + missingCapabilities.join(", "),
        "CAPABILITY_UNAVAILABLE"
      );
    }

    this.schemas.assert(
      action.payloadSchema,
      input.payload,
      "payload for adapter action " + action.id
    );

    const payload = structuredClone(input.payload);
    const payloadHash = createHash("sha256")
      .update(canonicalJson(payload), "utf8")
      .digest("hex");
    const idempotencyKey = this.getIdempotencyKey(
      input.serverInstanceId,
      input.adapterId,
      input.idempotencyKey
    );
    const priorTaskId = this.idempotency.get(idempotencyKey);

    if (priorTaskId) {
      const prior = this.tasks.get(priorTaskId);
      if (prior && prior.payloadHash === payloadHash && prior.actionId === action.id) {
        return this.snapshot(prior);
      }

      throw new SampAiError(
        "Idempotency key was already used for a different task payload or action.",
        "IDEMPOTENCY_CONFLICT"
      );
    }

    const activeQueueCount = [...this.tasks.values()].filter(
      (task) =>
        task.serverInstanceId === input.serverInstanceId &&
        task.adapterId === input.adapterId &&
        (task.state === "queued" || task.state === "leased")
    ).length;

    if (activeQueueCount >= this.maxQueuePerAdapter) {
      throw new SampAiError(
        "Adapter task queue is full.",
        "TASK_QUEUE_FULL"
      );
    }

    const ttlMs = input.ttlMs ?? this.defaultTtlMs;
    const maxAttempts = input.maxAttempts ?? this.defaultMaxAttempts;

    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 60 * 60_000) {
      throw new SampAiError(
        "Task TTL must be between 1000ms and 3600000ms.",
        "TASK_TTL_INVALID"
      );
    }

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new SampAiError(
        "Task maxAttempts must be between 1 and 10.",
        "TASK_ATTEMPTS_INVALID"
      );
    }

    const now = Date.now();
    const task: TaskRecord = {
      taskId: randomUUID(),
      serverInstanceId: input.serverInstanceId,
      adapterId: input.adapterId,
      actionId: action.id,
      payload,
      payloadHash,
      requiredCapabilities: Object.freeze([...action.requiredCapabilities]),
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      maxAttempts,
      attempts: 0,
      state: "queued"
    };

    this.tasks.set(task.taskId, task);
    this.idempotency.set(idempotencyKey, task.taskId);
    return this.snapshot(task);
  }

  claimNext(
    serverInstanceId: string,
    adapterId: string
  ): LeasedAdapterTask | undefined {
    this.refreshExpired();
    const adapter = this.adapters.getAdapter(serverInstanceId, adapterId);

    const task = [...this.tasks.values()]
      .filter((item) =>
        item.serverInstanceId === serverInstanceId &&
        item.adapterId === adapterId &&
        item.state === "queued" &&
        item.requiredCapabilities.every((capability) =>
          adapter.capabilities.includes(capability)
        )
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (!task) return undefined;

    task.state = "leased";
    task.attempts += 1;
    task.leaseToken = randomBytes(32).toString("base64url");
    task.leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();

    return Object.freeze({
      ...this.snapshot(task),
      leaseToken: task.leaseToken,
      leaseExpiresAt: task.leaseExpiresAt
    });
  }

  renewLease(
    serverInstanceId: string,
    adapterId: string,
    taskId: string,
    leaseToken: string
  ): LeasedAdapterTask {
    this.refreshExpired();
    const task = this.getOwnedTask(serverInstanceId, adapterId, taskId);
    this.assertValidLease(task, leaseToken);

    task.leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();

    return Object.freeze({
      ...this.snapshot(task),
      leaseToken: task.leaseToken!,
      leaseExpiresAt: task.leaseExpiresAt
    });
  }

  complete(
    serverInstanceId: string,
    adapterId: string,
    taskId: string,
    leaseToken: string,
    result: AdapterTaskResult
  ): AdapterTaskSnapshot {
    this.refreshExpired();
    const task = this.getOwnedTask(serverInstanceId, adapterId, taskId);
    this.assertValidLease(task, leaseToken);

    const action: AdapterActionDefinition = this.actions.get(task.actionId);

    if (result.status === "failed") {
      if (!result.error?.code || !result.error.message) {
        throw new SampAiError(
          "Failed task results must include an error code and message.",
          "TASK_RESULT_INVALID"
        );
      }
    } else {
      this.schemas.assert(
        action.resultSchema,
        result.output,
        "result for adapter action " + action.id
      );
    }

    task.state = result.status;
    task.result = Object.freeze(structuredClone(result));
    delete task.leaseToken;
    delete task.leaseExpiresAt;

    return this.snapshot(task);
  }

  getTask(taskId: string, serverInstanceId: string): AdapterTaskSnapshot {
    this.refreshExpired();
    const task = this.tasks.get(taskId);

    if (!task || task.serverInstanceId !== serverInstanceId) {
      throw new SampAiError("Adapter task was not found.", "TASK_NOT_FOUND");
    }

    return this.snapshot(task);
  }

  pruneCompleted(retentionMs = 60 * 60_000): number {
    const cutoff = Date.now() - retentionMs;
    let removed = 0;

    for (const [taskId, task] of this.tasks) {
      const finalState = task.state === "succeeded" ||
        task.state === "partially_succeeded" ||
        task.state === "failed" ||
        task.state === "expired";

      if (finalState && Date.parse(task.createdAt) < cutoff) {
        this.tasks.delete(taskId);
        this.idempotency.delete(
          this.getIdempotencyKey(
            task.serverInstanceId,
            task.adapterId,
            task.idempotencyKey
          )
        );
        removed += 1;
      }
    }

    return removed;
  }

  private getOwnedTask(
    serverInstanceId: string,
    adapterId: string,
    taskId: string
  ): TaskRecord {
    const task = this.tasks.get(taskId);

    if (!task ||
        task.serverInstanceId !== serverInstanceId ||
        task.adapterId !== adapterId) {
      throw new SampAiError("Adapter task was not found.", "TASK_NOT_FOUND");
    }

    return task;
  }

  private assertValidLease(task: TaskRecord, leaseToken: string): void {
    if (
      task.state !== "leased" ||
      !task.leaseToken ||
      !task.leaseExpiresAt ||
      task.leaseToken !== leaseToken ||
      Date.parse(task.leaseExpiresAt) <= Date.now()
    ) {
      throw new SampAiError(
        "Task lease is missing, expired, or does not belong to this adapter.",
        "TASK_LEASE_INVALID"
      );
    }
  }

  private refreshExpired(): void {
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (
        task.state === "queued" &&
        Date.parse(task.expiresAt) <= now
      ) {
        task.state = "expired";
        continue;
      }

      if (
        task.state === "leased" &&
        task.leaseExpiresAt &&
        Date.parse(task.leaseExpiresAt) <= now
      ) {
        delete task.leaseToken;
        delete task.leaseExpiresAt;

        if (Date.parse(task.expiresAt) <= now) {
          task.state = "expired";
        } else if (task.attempts >= task.maxAttempts) {
          task.state = "failed";
          task.result = {
            status: "failed",
            error: {
              code: "TASK_LEASE_EXHAUSTED",
              message: "Adapter did not complete the task before the lease expired."
            }
          };
        } else {
          task.state = "queued";
        }
      }
    }
  }

  private snapshot(task: TaskRecord): AdapterTaskSnapshot {
    return Object.freeze({
      taskId: task.taskId,
      serverInstanceId: task.serverInstanceId,
      adapterId: task.adapterId,
      actionId: task.actionId,
      payload: structuredClone(task.payload),
      requiredCapabilities: Object.freeze([...task.requiredCapabilities]),
      idempotencyKey: task.idempotencyKey,
      createdAt: task.createdAt,
      expiresAt: task.expiresAt,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      state: task.state,
      ...(task.result ? { result: structuredClone(task.result) } : {})
    });
  }

  private getIdempotencyKey(
    serverInstanceId: string,
    adapterId: string,
    idempotencyKey: string
  ): string {
    return serverInstanceId + "::" + adapterId + "::" + idempotencyKey;
  }
}
