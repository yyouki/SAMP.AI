export class SampAiError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class SchemaValidationError extends SampAiError {
  constructor(
    message: string,
    readonly issues: readonly string[]
  ) {
    super(message, "INVALID_SCHEMA");
  }
}

export class AuthorizationError extends SampAiError {
  constructor(
    message: string,
    code:
      | "PERMISSION_DENIED"
      | "CAPABILITY_UNAVAILABLE"
      | "AUTONOMY_RESTRICTED"
      | "APPROVAL_REQUIRED"
      | "APPROVAL_INVALID"
  ) {
    super(message, code);
  }
}

export class ToolNotFoundError extends SampAiError {
  constructor(toolId: string) {
    super(`Tool is not registered: ${toolId}`, "TOOL_NOT_FOUND");
  }
}

export class ToolTimeoutError extends SampAiError {
  constructor(toolId: string, timeoutMs: number) {
    super(`Tool timed out after ${timeoutMs}ms: ${toolId}`, "TOOL_TIMEOUT");
  }
}

export class ExtensionLoadError extends SampAiError {
  constructor(message: string, code = "EXTENSION_INVALID") {
    super(message, code);
  }
}

export class AuditPersistenceError extends SampAiError {
  constructor(toolId: string) {
    super(
      `Tool may have completed, but its success audit could not be persisted: ${toolId}. Check operation state before retrying.`,
      "AUDIT_PERSISTENCE_FAILED"
    );
  }
}

export class AuditRequiredError extends SampAiError {
  constructor(toolId: string) {
    super(
      `An audit sink is required before non-read tool execution: ${toolId}`,
      "AUDIT_REQUIRED"
    );
  }
}

export class ToolCancelledError extends SampAiError {
  constructor(toolId: string) {
    super(`Tool execution was cancelled: ${toolId}`, "TOOL_CANCELLED");
  }
}
