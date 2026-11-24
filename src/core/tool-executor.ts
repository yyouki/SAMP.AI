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
    try {
      await this.permissions.assertAuthorized(tool, context);
    } catch (error) {
      await this.writeAudit({
        event: "tool.denied",
        toolId: tool.id,
        actorId: context.actor.id,
        serverInstanceId: context.serverInstanceId,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        timestamp: new Date().toISOString(),
        details: {
          code: error instanceof Error && "code" in error
            ? String((error as { code: unknown }).code)
            : "AUTHORIZATION_FAILED"
        }
      });
      throw error;
    }

    this.schemas.assert(tool.inputSchema, input, `input for ${tool.id}`);

    // Persist the start event before any side effect. A configured audit sink is fail-closed.
    await this.writeAudit({
      event: "tool.started",
      toolId: tool.id,
      actorId: context.actor.id,
      serverInstanceId: context.serverInstanceId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      timestamp: new Date().toISOString()
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);
    let output: unknown;

    try {
      output = await this.invokeWithTimeout(tool, input, context, controller);
      this.schemas.assert(tool.outputSchema, output, `output from ${tool.id}`);
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

    // Keep success-audit failures separate: the tool may already have completed.
    await this.writeAudit({
      event: "tool.succeeded",
      toolId: tool.id,
      actorId: context.actor.id,
      serverInstanceId: context.serverInstanceId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      timestamp: new Date().toISOString()
    });

    return output as TOutput;
  }

  private async invokeWithTimeout(
    tool: ToolDefinition,
    input: unknown,
    context: ExecutionContext,
    controller: AbortController
  ): Promise<unknown> {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
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

    return Promise.race([executionPromise, timeoutPromise]);
  }

  private async writeAudit(
    event: Parameters<AuditSink["write"]>[0]
  ): Promise<void> {
    await this.audit?.write(event);
  }
}
