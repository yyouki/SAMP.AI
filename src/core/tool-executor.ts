import { AuditPersistenceError, AuditRequiredError, ToolTimeoutError } from "./errors.js";
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

  execute<TOutput = unknown>(
    toolId: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<TOutput> {
    return this.executeDefinition(this.registry.get(toolId), input, context);
  }

  /** Resolve an extension binding to its already-registered implementation. */
  executeImplementation<TOutput = unknown>(
    implementationId: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<TOutput> {
    return this.executeDefinition(
      this.registry.getImplementation(implementationId),
      input,
      context
    );
  }

  private async executeDefinition<TOutput>(
    tool: ToolDefinition,
    input: unknown,
    context: ExecutionContext
  ): Promise<TOutput> {
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

    if (tool.effect !== "read" && !this.audit) {
      throw new AuditRequiredError(tool.id);
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

    // The operation may already have completed if persisting this final event fails.
    try {
      await this.writeAudit({
        event: "tool.succeeded",
        toolId: tool.id,
        actorId: context.actor.id,
        serverInstanceId: context.serverInstanceId,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        timestamp: new Date().toISOString()
      });
    } catch {
      // A side effect may already have completed; do not imply it is safe to retry blindly.
      throw new AuditPersistenceError(tool.id);
    }

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
