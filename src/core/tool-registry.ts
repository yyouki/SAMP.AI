import { ToolNotFoundError } from "./errors.js";
import type { ToolDefinition } from "../shared/contracts.js";

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as unknown as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function snapshotTool(tool: ToolDefinition): ToolDefinition {
  // Copy caller-owned arrays and JSON schemas before freezing registry metadata.
  return deepFreeze({
    ...tool,
    requiredPermissions: [...tool.requiredPermissions],
    requiredCapabilities: [...tool.requiredCapabilities],
    inputSchema: structuredClone(tool.inputSchema),
    outputSchema: structuredClone(tool.outputSchema)
  });
}

export class ToolRegistry {
  private readonly byId = new Map<string, ToolDefinition>();
  private readonly byImplementation = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (!TOOL_ID_PATTERN.test(tool.id) || !TOOL_ID_PATTERN.test(tool.implementationId)) {
      throw new Error("Tool IDs must use a stable dotted identifier.");
    }

    if (this.byId.has(tool.id)) {
      throw new Error(`Tool ID is already registered: ${tool.id}`);
    }

    if (this.byImplementation.has(tool.implementationId)) {
      throw new Error(
        `Tool implementation is already registered: ${tool.implementationId}`
      );
    }

    if (tool.timeoutMs < 100 || tool.timeoutMs > 30_000) {
      throw new Error("Tool timeout must be between 100ms and 30000ms.");
    }

    const snapshot = snapshotTool(tool);
    this.byId.set(snapshot.id, snapshot);
    this.byImplementation.set(snapshot.implementationId, snapshot);
  }

  get(toolId: string): ToolDefinition {
    const tool = this.byId.get(toolId);

    if (!tool) {
      throw new ToolNotFoundError(toolId);
    }

    return tool;
  }

  getImplementation(implementationId: string): ToolDefinition {
    const tool = this.byImplementation.get(implementationId);

    if (!tool) {
      throw new ToolNotFoundError(implementationId);
    }

    return tool;
  }

  hasImplementation(implementationId: string): boolean {
    return this.byImplementation.has(implementationId);
  }

  list(): readonly Omit<ToolDefinition, "handler">[] {
    return [...this.byId.values()].map(({ handler: _handler, ...metadata }) => metadata);
  }
}
