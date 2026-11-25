import { randomUUID } from "node:crypto";
import { SampAiError } from "../../core/errors.js";
import type { AdapterActionDefinition, AdapterActionRegistry } from "../adapter-action-registry.js";
import type { AdapterRegistry, RegisteredAdapter } from "../adapter-registry.js";
import type { AdapterTaskQueue, AdapterTaskSnapshot } from "../adapter-task-queue.js";
import type { JsonSchema } from "../../shared/contracts.js";

export interface MockVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MockPlayerState {
  readonly player_id: number;
  readonly position: MockVector3;
  readonly facing: number;
  readonly interior_id: number;
  readonly virtual_world_id: number;
}

export interface MockGameObject {
  readonly object_id: string;
  readonly project_id: string;
  readonly model_id: number;
  readonly position: MockVector3;
  readonly rotation: MockVector3;
  readonly interior_id: number;
  readonly virtual_world_id: number;
}

export interface MockAnchor {
  readonly anchor_id: string;
  readonly project_id: string;
  readonly position: MockVector3;
  readonly rotation: MockVector3;
  readonly interior_id: number;
  readonly virtual_world_id: number;
}

export interface MockMarker {
  readonly marker_id: string;
  readonly project_id: string;
  readonly position: MockVector3;
  readonly color: string;
}

export interface MockNativeRemovalDirective {
  readonly directive_id: string;
  readonly player_id: number;
  readonly session_id: string;
  readonly model_id: number;
  readonly center: MockVector3;
  readonly radius: number;
  readonly simulated: true;
  readonly undo_strategy: "reconnect_required";
}

export interface MockAdapterFailure {
  readonly code: string;
  readonly message: string;
}

const vectorSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number", minimum: -100000, maximum: 100000 },
    y: { type: "number", minimum: -100000, maximum: 100000 },
    z: { type: "number", minimum: -100000, maximum: 100000 }
  },
  required: ["x", "y", "z"]
};

const operationIdSchema = { type: "string", minLength: 8, maxLength: 128 };
const projectIdSchema = { type: "string", minLength: 1, maxLength: 100 };
const entityIdSchema = { type: "string", minLength: 1, maxLength: 100 };
const integerIdSchema = { type: "integer", minimum: 0, maximum: 2_147_483_647 };

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = Object.keys(properties)
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [...required]
  };
}

const positionProperties = {
  position: vectorSchema,
  rotation: vectorSchema,
  interior_id: { type: "integer", minimum: 0, maximum: 255 },
  virtual_world_id: integerIdSchema
};

const transformResultProperties = {
  position: vectorSchema,
  rotation: vectorSchema,
  interior_id: { type: "integer", minimum: 0, maximum: 255 },
  virtual_world_id: integerIdSchema
};

function action(
  id: string,
  description: string,
  capability: string,
  effect: AdapterActionDefinition["effect"],
  risk: AdapterActionDefinition["risk"],
  compensation: AdapterActionDefinition["compensation"],
  payloadSchema: JsonSchema,
  resultSchema: JsonSchema
): AdapterActionDefinition {
  return {
    id,
    description,
    requiredCapabilities: [capability],
    effect,
    risk,
    // Mutations use operation_id and an in-process result ledger for safe replay.
    idempotent: true,
    compensation,
    payloadSchema,
    resultSchema
  };
}

const objectResultSchema = objectSchema({
  object_id: entityIdSchema,
  project_id: projectIdSchema,
  model_id: { type: "integer", minimum: 1, maximum: 65535 },
  ...transformResultProperties
});

const anchorResultSchema = objectSchema({
  anchor_id: entityIdSchema,
  project_id: projectIdSchema,
  ...transformResultProperties
});

const markerResultSchema = objectSchema({
  marker_id: entityIdSchema,
  project_id: projectIdSchema,
  position: vectorSchema,
  color: { type: "string", minLength: 1, maxLength: 32 }
});

const resultSchemas: Record<string, JsonSchema> = {
  "context.get_player_state": objectSchema({
    player_id: { type: "integer", minimum: 0, maximum: 1004 },
    found: { type: "boolean" },
    position: vectorSchema,
    facing: { type: "number" },
    interior_id: { type: "integer", minimum: 0, maximum: 255 },
    virtual_world_id: integerIdSchema
  }, ["player_id", "found"]),
  "anchor.create": anchorResultSchema,
  "anchor.list": objectSchema({
    project_id: projectIdSchema,
    anchors: { type: "array" }
  }),
  "marker.create": markerResultSchema,
  "marker.remove": objectSchema({
    marker_id: entityIdSchema,
    removed: { type: "boolean" }
  }),
  "mapping.inspect": objectSchema({
    project_id: projectIdSchema,
    objects: { type: "array" },
    truncated: { type: "boolean" }
  }),
  "mapping.create_object": objectResultSchema,
  "mapping.update_object": objectResultSchema,
  "mapping.delete_object": objectSchema({
    object_id: entityIdSchema,
    removed: { type: "boolean" }
  }),
  "world.default_object.remove": objectSchema({
    directive_id: entityIdSchema,
    player_id: { type: "integer", minimum: 0, maximum: 1004 },
    session_id: entityIdSchema,
    applied: { type: "boolean" },
    simulated: { const: true },
    undo_strategy: { const: "reconnect_required" }
  })
};

const definitions: AdapterActionDefinition[] = [
  action(
    "context.get_player_state",
    "Read a player's simulated position and world context.",
    "context.player_state",
    "read",
    "low",
    "none",
    objectSchema({ player_id: { type: "integer", minimum: 0, maximum: 1004 } }),
    resultSchemas["context.get_player_state"]!
  ),
  action(
    "anchor.create",
    "Create or replace a named project anchor in the mock world.",
    "anchor.create",
    "mutate",
    "medium",
    "undo",
    objectSchema({
      operation_id: operationIdSchema,
      anchor_id: entityIdSchema,
      project_id: projectIdSchema,
      ...positionProperties
    }),
    resultSchemas["anchor.create"]!
  ),
  action(
    "anchor.list",
    "List anchors belonging to a mapping project.",
    "anchor.list",
    "read",
    "low",
    "none",
    objectSchema({ project_id: projectIdSchema }),
    resultSchemas["anchor.list"]!
  ),
  action(
    "marker.create",
    "Create a temporary review marker at a world coordinate.",
    "marker.create",
    "mutate",
    "low",
    "undo",
    objectSchema({
      operation_id: operationIdSchema,
      marker_id: entityIdSchema,
      project_id: projectIdSchema,
      position: vectorSchema,
      color: { type: "string", minLength: 1, maxLength: 32 }
    }),
    resultSchemas["marker.create"]!
  ),
  action(
    "marker.remove",
    "Remove a temporary review marker.",
    "marker.remove",
    "delete",
    "low",
    "undo",
    objectSchema({
      operation_id: operationIdSchema,
      marker_id: entityIdSchema,
      project_id: projectIdSchema
    }),
    resultSchemas["marker.remove"]!
  ),
  action(
    "mapping.inspect",
    "Inspect a bounded collection of server-created mapping objects.",
    "mapping.inspect",
    "read",
    "low",
    "none",
    objectSchema({
      project_id: projectIdSchema,
      max_objects: { type: "integer", minimum: 1, maximum: 5000 }
    }, ["project_id"]),
    resultSchemas["mapping.inspect"]!
  ),
  action(
    "mapping.create_object",
    "Create one server object in a mapping project.",
    "mapping.create_object",
    "mutate",
    "medium",
    "undo",
    objectSchema({
      operation_id: operationIdSchema,
      object_id: entityIdSchema,
      project_id: projectIdSchema,
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      ...positionProperties
    }),
    resultSchemas["mapping.create_object"]!
  ),
  action(
    "mapping.update_object",
    "Update the transform or model of a server-created mapping object.",
    "mapping.update_object",
    "mutate",
    "medium",
    "undo",
    objectSchema({
      operation_id: operationIdSchema,
      object_id: entityIdSchema,
      project_id: projectIdSchema,
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      ...positionProperties
    }, ["operation_id", "object_id", "project_id"]),
    resultSchemas["mapping.update_object"]!
  ),
  action(
    "mapping.delete_object",
    "Delete one server-created mapping object.",
    "mapping.delete_object",
    "delete",
    "high",
    "undo",
    objectSchema({
      operation_id: operationIdSchema,
      object_id: entityIdSchema,
      project_id: projectIdSchema
    }),
    resultSchemas["mapping.delete_object"]!
  ),
  action(
    "world.default_object.remove",
    "Record a per-player native-world removal directive in simulation only.",
    "world.default_objects.remove_per_player",
    "mutate",
    "critical",
    "reconnect_required",
    objectSchema({
      operation_id: operationIdSchema,
      directive_id: entityIdSchema,
      player_id: { type: "integer", minimum: 0, maximum: 1004 },
      session_id: entityIdSchema,
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      center: vectorSchema,
      radius: { type: "number", minimum: 0, maximum: 1000 }
    }),
    resultSchemas["world.default_object.remove"]!
  )
];

export const MOCK_GAME_ADAPTER_CAPABILITIES = Object.freeze([
  "context.player_state",
  "anchor.create",
  "anchor.list",
  "marker.create",
  "marker.remove",
  "mapping.inspect",
  "mapping.create_object",
  "mapping.update_object",
  "mapping.delete_object",
  "world.default_objects.remove_per_player"
]);

/** Register every action implemented by the deterministic mock game adapter. */
export function registerMockGameActions(registry: AdapterActionRegistry): void {
  for (const definition of definitions) {
    registry.register(definition);
  }
}

/** Register a protocol-compatible mock runtime for a server instance. */
export function registerMockGameAdapter(
  registry: AdapterRegistry,
  serverInstanceId: string,
  adapterId = "sampai-mock"
): RegisteredAdapter {
  return registry.registerHello({
    protocol: "sampai/0.1",
    message_id: "mock_hello_" + randomUUID(),
    type: "event",
    server_instance_id: serverInstanceId,
    timestamp: new Date().toISOString(),
    event: "adapter.hello",
    payload: {
      adapter: {
        name: adapterId,
        version: "0.1.0",
        runtime: "mock"
      },
      capabilities: [...MOCK_GAME_ADAPTER_CAPABILITIES],
      limits: {
        max_operations_per_batch: 100,
        max_objects_per_project: 10000
      }
    }
  }, { adapterId, serverInstanceId });
}

interface OperationReceipt {
  readonly payload: string;
  readonly result: unknown;
}

type ActionPayload = Record<string, unknown>;
type ActionHandler = (payload: ActionPayload) => unknown;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map(
      (key) => JSON.stringify(key) + ":" + stableStringify(record[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

function asVector(value: unknown): MockVector3 {
  return structuredClone(value as MockVector3);
}

/**
 * In-memory game simulation. It deliberately does not call a real SA-MP/open.mp
 * runtime; tasks and their results follow the same validated queue contract.
 */
export class MockGameAdapter {
  private readonly players = new Map<number, MockPlayerState>();
  private readonly objects = new Map<string, MockGameObject>();
  private readonly anchors = new Map<string, MockAnchor>();
  private readonly markers = new Map<string, MockMarker>();
  private readonly nativeDirectives = new Map<string, MockNativeRemovalDirective>();
  private readonly operationReceipts = new Map<string, OperationReceipt>();
  private readonly nextFailures = new Map<string, MockAdapterFailure>();

  constructor(
    private readonly queue: AdapterTaskQueue,
    readonly serverInstanceId: string,
    readonly adapterId = "sampai-mock"
  ) {
    if (!serverInstanceId.trim() || !adapterId.trim()) {
      throw new Error("Mock adapter identity must not be empty.");
    }
  }

  setPlayerState(state: MockPlayerState): void {
    this.players.set(state.player_id, Object.freeze(structuredClone(state)));
  }

  /** Inject one deterministic failure for the next task with this action ID. */
  failNext(actionId: string, failure: MockAdapterFailure): void {
    this.nextFailures.set(actionId, Object.freeze({ ...failure }));
  }

  getObjects(projectId?: string): readonly MockGameObject[] {
    return Object.freeze([...this.objects.values()]
      .filter((item) => projectId === undefined || item.project_id === projectId)
      .map((item) => structuredClone(item)));
  }

  getAnchors(projectId?: string): readonly MockAnchor[] {
    return Object.freeze([...this.anchors.values()]
      .filter((item) => projectId === undefined || item.project_id === projectId)
      .map((item) => structuredClone(item)));
  }

  getMarkers(projectId?: string): readonly MockMarker[] {
    return Object.freeze([...this.markers.values()]
      .filter((item) => projectId === undefined || item.project_id === projectId)
      .map((item) => structuredClone(item)));
  }

  getNativeRemovalDirectives(): readonly MockNativeRemovalDirective[] {
    return Object.freeze([...this.nativeDirectives.values()].map((item) => structuredClone(item)));
  }

  /** Claim and execute one task, then submit a schema-validated result to the queue. */
  processNext(): AdapterTaskSnapshot | undefined {
    const task = this.queue.claimNext(this.serverInstanceId, this.adapterId);
    if (!task) return undefined;

    const injectedFailure = this.nextFailures.get(task.actionId);
    if (injectedFailure) {
      this.nextFailures.delete(task.actionId);
      return this.queue.complete(
        this.serverInstanceId,
        this.adapterId,
        task.taskId,
        task.leaseToken,
        { status: "failed", error: injectedFailure }
      );
    }

    try {
      const output = this.execute(task.actionId, task.payload as ActionPayload);
      return this.queue.complete(
        this.serverInstanceId,
        this.adapterId,
        task.taskId,
        task.leaseToken,
        { status: "succeeded", output }
      );
    } catch (error) {
      const failure: MockAdapterFailure = {
        code: error instanceof SampAiError ? error.code : "MOCK_ADAPTER_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : "Mock adapter execution failed."
      };
      return this.queue.complete(
        this.serverInstanceId,
        this.adapterId,
        task.taskId,
        task.leaseToken,
        { status: "failed", error: failure }
      );
    }
  }

  /** Process up to maxTasks in FIFO order; stop when the queue is empty. */
  processAvailable(maxTasks = 10): readonly AdapterTaskSnapshot[] {
    if (!Number.isInteger(maxTasks) || maxTasks < 1 || maxTasks > 1000) {
      throw new Error("maxTasks must be an integer between 1 and 1000.");
    }

    const results: AdapterTaskSnapshot[] = [];
    for (let index = 0; index < maxTasks; index += 1) {
      const result = this.processNext();
      if (!result) break;
      results.push(result);
    }
    return Object.freeze(results);
  }

  private execute(actionId: string, payload: ActionPayload): unknown {
    if (actionId === "context.get_player_state") {
      const playerId = payload.player_id as number;
      const player = this.players.get(playerId);
      return player
        ? { ...structuredClone(player), found: true }
        : { player_id: playerId, found: false };
    }

    if (actionId === "anchor.list") {
      const projectId = payload.project_id as string;
      return {
        project_id: projectId,
        anchors: this.filterByProject(this.anchors, projectId)
      };
    }

    if (actionId === "mapping.inspect") {
      const projectId = payload.project_id as string;
      const all = this.filterByProject(this.objects, projectId);
      const maxObjects = (payload.max_objects as number | undefined) ?? 500;
      return {
        project_id: projectId,
        objects: all.slice(0, maxObjects),
        truncated: all.length > maxObjects
      };
    }

    if (actionId === "world.default_object.remove") {
      return this.applyIdempotent(actionId, payload, () => {
        const directive: MockNativeRemovalDirective = Object.freeze({
          directive_id: payload.directive_id as string,
          player_id: payload.player_id as number,
          session_id: payload.session_id as string,
          model_id: payload.model_id as number,
          center: asVector(payload.center),
          radius: payload.radius as number,
          simulated: true,
          undo_strategy: "reconnect_required"
        });
        const key = [directive.session_id, directive.player_id, directive.directive_id].join(":");
        this.nativeDirectives.set(key, directive);
        return {
          directive_id: directive.directive_id,
          player_id: directive.player_id,
          session_id: directive.session_id,
          applied: true,
          simulated: true,
          undo_strategy: "reconnect_required"
        };
      });
    }

    const handlers: Record<string, ActionHandler> = {
      "anchor.create": (input) => {
        const anchor: MockAnchor = Object.freeze({
          anchor_id: input.anchor_id as string,
          project_id: input.project_id as string,
          position: asVector(input.position),
          rotation: asVector(input.rotation),
          interior_id: input.interior_id as number,
          virtual_world_id: input.virtual_world_id as number
        });
        this.anchors.set(this.entityKey(anchor.project_id, anchor.anchor_id), anchor);
        return structuredClone(anchor);
      },
      "marker.create": (input) => {
        const marker: MockMarker = Object.freeze({
          marker_id: input.marker_id as string,
          project_id: input.project_id as string,
          position: asVector(input.position),
          color: input.color as string
        });
        this.markers.set(this.entityKey(marker.project_id, marker.marker_id), marker);
        return structuredClone(marker);
      },
      "marker.remove": (input) => {
        const key = this.entityKey(input.project_id as string, input.marker_id as string);
        return {
          marker_id: input.marker_id as string,
          removed: this.markers.delete(key)
        };
      },
      "mapping.create_object": (input) => {
        const object: MockGameObject = Object.freeze({
          object_id: input.object_id as string,
          project_id: input.project_id as string,
          model_id: input.model_id as number,
          position: asVector(input.position),
          rotation: asVector(input.rotation),
          interior_id: input.interior_id as number,
          virtual_world_id: input.virtual_world_id as number
        });
        const key = this.entityKey(object.project_id, object.object_id);
        if (this.objects.has(key)) {
          throw new SampAiError("Mapping object already exists: " + object.object_id, "MOCK_OBJECT_CONFLICT");
        }
        this.objects.set(key, object);
        return structuredClone(object);
      },
      "mapping.update_object": (input) => {
        const key = this.entityKey(input.project_id as string, input.object_id as string);
        const prior = this.objects.get(key);
        if (!prior) {
          throw new SampAiError("Mapping object was not found: " + String(input.object_id), "MOCK_OBJECT_NOT_FOUND");
        }
        const updated: MockGameObject = Object.freeze({
          ...prior,
          ...(input.model_id === undefined ? {} : { model_id: input.model_id as number }),
          ...(input.position === undefined ? {} : { position: asVector(input.position) }),
          ...(input.rotation === undefined ? {} : { rotation: asVector(input.rotation) }),
          ...(input.interior_id === undefined ? {} : { interior_id: input.interior_id as number }),
          ...(input.virtual_world_id === undefined ? {} : { virtual_world_id: input.virtual_world_id as number })
        });
        this.objects.set(key, updated);
        return structuredClone(updated);
      },
      "mapping.delete_object": (input) => {
        const key = this.entityKey(input.project_id as string, input.object_id as string);
        return {
          object_id: input.object_id as string,
          removed: this.objects.delete(key)
        };
      }
    };

    const handler = handlers[actionId];
    if (!handler) {
      throw new SampAiError("Mock adapter does not implement action: " + actionId, "MOCK_ACTION_UNSUPPORTED");
    }

    return this.applyIdempotent(actionId, payload, () => handler(payload));
  }

  private applyIdempotent(
    actionId: string,
    payload: ActionPayload,
    apply: () => unknown
  ): unknown {
    const operationId = payload.operation_id as string | undefined;
    if (!operationId) {
      throw new SampAiError("Mutating mock actions require operation_id.", "MOCK_OPERATION_ID_REQUIRED");
    }

    const receiptKey = actionId + ":" + operationId;
    const payloadHash = stableStringify(payload);
    const prior = this.operationReceipts.get(receiptKey);

    if (prior) {
      if (prior.payload !== payloadHash) {
        throw new SampAiError("operation_id was reused with a different payload.", "MOCK_OPERATION_CONFLICT");
      }
      return structuredClone(prior.result);
    }

    const result = apply();
    this.operationReceipts.set(receiptKey, {
      payload: payloadHash,
      result: structuredClone(result)
    });
    return structuredClone(result);
  }

  private filterByProject<T extends { readonly project_id: string }>(
    records: Map<string, T>,
    projectId: string
  ): T[] {
    return [...records.values()]
      .filter((item) => item.project_id === projectId)
      .map((item) => structuredClone(item));
  }

  private entityKey(projectId: string, entityId: string): string {
    return projectId + "::" + entityId;
  }
}
