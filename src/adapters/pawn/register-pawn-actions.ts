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

const portableId = (minLength: number, maxLength: number) => ({
  type: "string",
  minLength,
  maxLength,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
});

const playerStateAction: AdapterActionDefinition = {
  id: "context.get_player_state",
  description: "Read an online player's measured position, world context, and connection session.",
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
      session_id: { type: "string", maxLength: 100 },
      position: vectorSchema,
      facing: { type: "number", minimum: 0, maximum: 360 },
      interior_id: { type: "integer", minimum: 0, maximum: 255 },
      virtual_world_id: { type: "integer", minimum: 0, maximum: 2147483647 }
    },
    required: ["player_id", "found", "session_id"]
  }
};

const createObjectAction: AdapterActionDefinition = {
  id: "mapping.create_object",
  description: "Create a server-wide global object; this native cannot scope it to one interior or virtual world.",
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
      operation_id: portableId(8, 128),
      object_id: portableId(1, 100),
      project_id: portableId(1, 100),
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      position: vectorSchema,
      rotation: vectorSchema,
      interior_id: { const: 0, description: "Only the default interior is accepted; CreateObject remains a global object." },
      virtual_world_id: { const: 0, description: "Only the default virtual world is accepted; CreateObject remains a global object." }
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
      object_id: portableId(1, 100),
      project_id: portableId(1, 100),
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      runtime_object_id: { type: "integer", minimum: 0, maximum: 65535 },
      position: vectorSchema,
      rotation: vectorSchema,
      scope: { const: "global" },
      requested_interior_id: { const: 0 },
      requested_virtual_world_id: { const: 0 }
    },
    required: [
      "object_id",
      "project_id",
      "model_id",
      "position",
      "rotation",
      "scope",
      "requested_interior_id",
      "requested_virtual_world_id"
    ]
  }
};

const previewPlayerObjectAction: AdapterActionDefinition = {
  id: "mapping.preview_player_object",
  description: "Create or replace one temporary object visible only to the targeted player session.",
  requiredCapabilities: ["mapping.preview_player_object"],
  effect: "mutate",
  risk: "low",
  // A repeated preview request must not be blindly retried after an unknown outcome.
  idempotent: false,
  compensation: "undo",
  payloadSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      preview_id: portableId(1, 100),
      project_id: portableId(1, 100),
      player_id: { type: "integer", minimum: 0, maximum: 1004 },
      player_session_id: portableId(1, 100),
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      position: vectorSchema,
      rotation: vectorSchema
    },
    required: [
      "preview_id",
      "project_id",
      "player_id",
      "player_session_id",
      "model_id",
      "position",
      "rotation"
    ]
  },
  resultSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      preview_id: portableId(1, 100),
      project_id: portableId(1, 100),
      player_id: { type: "integer", minimum: 0, maximum: 1004 },
      player_session_id: portableId(1, 100),
      runtime_object_id: { type: "integer", minimum: 0, maximum: 65535 },
      model_id: { type: "integer", minimum: 1, maximum: 65535 },
      position: vectorSchema,
      rotation: vectorSchema,
      scope: { const: "player" }
    },
    required: [
      "preview_id",
      "project_id",
      "player_id",
      "player_session_id",
      "runtime_object_id",
      "model_id",
      "position",
      "rotation",
      "scope"
    ]
  }
};

const clearPlayerPreviewAction: AdapterActionDefinition = {
  id: "mapping.clear_player_preview",
  description: "Clear the targeted player's preview only when its preview ID and session still match.",
  requiredCapabilities: ["mapping.clear_player_preview"],
  effect: "delete",
  risk: "low",
  idempotent: true,
  compensation: "none",
  payloadSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      preview_id: portableId(1, 100),
      player_id: { type: "integer", minimum: 0, maximum: 1004 },
      player_session_id: portableId(1, 100)
    },
    required: ["preview_id", "player_id", "player_session_id"]
  },
  resultSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      preview_id: portableId(1, 100),
      player_id: { type: "integer", minimum: 0, maximum: 1004 },
      player_session_id: portableId(1, 100),
      cleared: { type: "boolean" },
      scope: { const: "player" }
    },
    required: ["preview_id", "player_id", "player_session_id", "cleared", "scope"]
  }
};

/** Register only operations implemented by the Pawn reference filterscript. */
export function registerPawnAdapterActions(
  registry: AdapterActionRegistry
): void {
  registry.register(playerStateAction);
  registry.register(createObjectAction);
  registry.register(previewPlayerObjectAction);
  registry.register(clearPlayerPreviewAction);
}

/** Expose immutable action definitions for documentation and conformance tests. */
export function listPawnAdapterActions(): readonly AdapterActionDefinition[] {
  return Object.freeze([
    playerStateAction,
    createObjectAction,
    previewPlayerObjectAction,
    clearPlayerPreviewAction
  ]);
}
