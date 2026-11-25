import type { AdapterActionDefinition } from "../adapter-action-registry.js";
import { AdapterActionRegistry } from "../adapter-action-registry.js";

const vectorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number", minimum: -100000, maximum: 100000 },
    y: { type: "number", minimum: -100000, maximum: 100000 },
    z: { type: "number", minimum: -100000, maximum: 100000 }
  },
  required: ["x", "y", "z"]
} as const;

const playerStateAction: AdapterActionDefinition = {
  id: "context.get_player_state",
  description: "Read an online player's measured world position and context.",
  requiredCapabilities: ["context.player_state"],
  effect: "read",
  risk: "low",
  idempotent: true,
  compensation: "none",
  payloadSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      player_id: { type: "integer", minimum: 0, maximum: 1004 }
    },
    required: ["player_id"]
  },
  resultSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      player_id: { type: "integer", minimum: 0, maximum: 1004 },
      found: { type: "boolean" },
      position: vectorSchema,
      facing: { type: "number", minimum: 0, maximum: 360 },
      interior_id: { type: "integer", minimum: 0, maximum: 255 },
      virtual_world_id: { type: "integer", minimum: 0, maximum: 2147483647 }
    },
    required: ["player_id", "found"]
  }
};

const createObjectAction: AdapterActionDefinition = {
  id: "mapping.create_object",
  description: "Create one global server object in world 0 and interior 0.",
  requiredCapabilities: ["mapping.create_object"],
  effect: "mutate",
  risk: "medium",
  // The Pawn sample cannot durably deduplicate across script/server restarts.
  idempotent: false,
  compensation: "manual",
  payloadSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operation_id: { type: "string", minLength: 8, maxLength: 128 },
      object_id: { type: "string", minLength: 1, maxLength: 100 },
      project_id: { type: "string", minLength: 1, maxLength: 100 },
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      position: vectorSchema,
      rotation: vectorSchema,
      interior_id: { type: "integer", minimum: 0, maximum: 255 },
      virtual_world_id: { type: "integer", minimum: 0, maximum: 2147483647 }
    },
    required: [
      "operation_id",
      "object_id",
      "project_id",
      "model_id",
      "position",
      "rotation",
      "interior_id",
      "virtual_world_id"
    ]
  },
  resultSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      object_id: { type: "string", minLength: 1, maxLength: 100 },
      project_id: { type: "string", minLength: 1, maxLength: 100 },
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      position: vectorSchema,
      rotation: vectorSchema,
      interior_id: { type: "integer", minimum: 0, maximum: 255 },
      virtual_world_id: { type: "integer", minimum: 0, maximum: 2147483647 }
    },
    required: [
      "object_id",
      "project_id",
      "model_id",
      "position",
      "rotation",
      "interior_id",
      "virtual_world_id"
    ]
  }
};

/** Register the first two action contracts implemented by the Pawn reference adapter. */
export function registerPawnAdapterActions(
  registry: AdapterActionRegistry
): void {
  registry.register(playerStateAction);
  registry.register(createObjectAction);
}

/** Expose immutable action definitions for documentation and conformance tests. */
export function listPawnAdapterActions(): readonly AdapterActionDefinition[] {
  return Object.freeze([playerStateAction, createObjectAction]);
}
