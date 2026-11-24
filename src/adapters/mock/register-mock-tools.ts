import type { ToolDefinition } from "../shared/contracts.js";
import { ToolRegistry } from "../core/tool-registry.js";

const inspectInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    project_id: { type: "string", minLength: 1, maxLength: 100 },
    area_anchor_id: { type: "string", minLength: 1, maxLength: 100 },
    max_objects: { type: "integer", minimum: 1, maximum: 5000 }
  },
  required: ["project_id"]
};

const inspectOutputSchema = {
  type: "object",
  properties: {
    project_id: { type: "string" },
    objects: { type: "array" },
    truncated: { type: "boolean" }
  },
  required: ["project_id", "objects", "truncated"]
};

/** Register deterministic read-only tools for protocol and extension tests. */
export function registerMockAdapterTools(registry: ToolRegistry): void {
  const inspectTool: ToolDefinition = {
    id: "mapping.inspect",
    implementationId: "mapping.inspect",
    description: "Read a bounded set of mapping objects from the mock adapter.",
    effect: "read",
    risk: "low",
    requiredPermissions: ["mapping.view"],
    requiredCapabilities: ["mapping.inspect"],
    inputSchema: inspectInputSchema,
    outputSchema: inspectOutputSchema,
    timeoutMs: 5000,
    idempotent: true,
    compensation: "none",
    handler: async (input) => {
      const args = input as { project_id: string };
      return {
        project_id: args.project_id,
        objects: [],
        truncated: false
      };
    }
  };

  registry.register(inspectTool);
}
