import { ToolNotFoundError } from "./errors.js";
import type { ToolDefinition } from "../shared/contracts.js";

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

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

    this.byId.set(tool.id, Object.freeze({ ...tool }));
    this.byImplementation.set(
      tool.implementationId,
      Object.freeze({ ...tool })
    );
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
