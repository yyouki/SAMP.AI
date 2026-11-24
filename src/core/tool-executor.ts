import { ToolTimeoutError } from "./errors.js";
import type {
  AuditSink,
  ExecutionContext,
  ToolDefinition
} from "../shared/contracts.js";
import { PermissionEngine } from "../security/permission-engine.js";
import { JsonSchemaValidator } from "../validation/json-schema-validator.js";
import { ToolRegistry } from "./tool-registry.js";

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissions: PermissionEngine,
    private readonly schemas: JsonSchemaValidator,
    private readonly audit?: AuditSink
  ) {}

  async execute<TOutput = unknown>(
    toolId: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<TOutput> {
    const tool = this.registry.get(toolId);

    // Authorization is checked before revealing schema details or invoking code.
    await this.permissions.assertAuthorized(tool, context);

    this.schemas.assert(tool.inputSchema, input, `input for ${tool.id}`);

    const startedAt = new Date().toISOString();
    await this.writeAudit({
      event: "tool.started",
      toolId: tool.id,
      actorId: context.actor.id,
      serverInstanceId: context.serverInstanceId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      timestamp: startedAt
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);

    try {
      const output = await this.invokeWithTimeout(
        tool,
        input,
        context,
        controller
      );

      this.schemas.assert(tool.outputSchema, output, `output from ${tool.id}`);

      await this.writeAudit({
        event: "tool.succeeded",
        toolId: tool.id,
        actorId: context.actor.id,
        serverInstanceId: context.serverInstanceId,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        timestamp: new Date().toISOString()
      });

      return output as TOutput;
    } catch (error) {
      await this.writeAudit({
        event: "tool.failed",
        toolId: tool.id,
        actorId: context.actor.id,
        serverInstanceId: context.serverInstanceId,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        timestamp: new Date().toISOString(),
        details: {
          message: error instanceof Error ? error.message : "Unknown error"
        }
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async invokeWithTimeout(
    tool: ToolDefinition,
    input: unknown,
    context: ExecutionContext,
    controller: AbortController
  ): Promise<unknown> {
    let rejectTimeout: ((reason: Error) => void) | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
      controller.signal.addEventListener(
        "abort",
        () => reject(new ToolTimeoutError(tool.id, tool.timeoutMs)),
        { once: true }
      );
    });

    const executionPromise = Promise.resolve().then(() =>
      tool.handler(input, {
        actorId: context.actor.id,
        serverInstanceId: context.serverInstanceId,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        signal: controller.signal
      })
    );

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      rejectTimeout = undefined;
    }
  }

  private async writeAudit(
    event: Parameters<AuditSink["write"]>[0]
  ): Promise<void> {
    // Fail closed when an audit sink is configured but unavailable.
    await this.audit?.write(event);
  }
}
