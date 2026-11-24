export type JsonSchema = Record<string, unknown>;

export type ToolEffect =
  | "read"
  | "draft"
  | "mutate"
  | "delete"
  | "publish"
  | "execute";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type CompensationStrategy =
  | "none"
  | "undo"
  | "compensation"
  | "manual"
  | "reconnect_required";

export type AutonomyMode =
  | "observe"
  | "suggest"
  | "draft_only"
  | "apply_with_approval"
  | "restricted_automation";

export interface ActorIdentity {
  readonly id: string;
  readonly permissions: readonly string[];
}

export interface ApprovalReceipt {
  readonly approvalId: string;
  readonly approvedBy: string;
  readonly toolId: string;
  readonly draftHash: string;
  readonly serverInstanceId: string;
  readonly projectId?: string;
  readonly issuedAt: string;
  readonly signature: string;
}

export interface ExecutionContext {
  readonly actor: ActorIdentity;
  readonly serverInstanceId: string;
  readonly projectId?: string;
  readonly adapterCapabilities: readonly string[];
  readonly autonomy: AutonomyMode;
  readonly autoAllowedToolIds?: readonly string[];
  readonly draftHash?: string;
  readonly approval?: ApprovalReceipt;
}

export interface ToolHandlerContext {
  readonly actorId: string;
  readonly serverInstanceId: string;
  readonly projectId?: string;
  readonly signal: AbortSignal;
}

export interface ToolDefinition {
  /** Stable ID used by the core registry. */
  readonly id: string;
  /** Implementation ID that extension manifests may bind to. */
  readonly implementationId: string;
  readonly description: string;
  readonly effect: ToolEffect;
  readonly risk: RiskLevel;
  readonly requiredPermissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly timeoutMs: number;
  readonly idempotent: boolean;
  readonly compensation: CompensationStrategy;
  readonly handler: (
    input: unknown,
    context: ToolHandlerContext
  ) => Promise<unknown> | unknown;
}

export interface ApprovalTarget {
  readonly toolId: string;
  readonly draftHash: string;
  readonly serverInstanceId: string;
  readonly projectId?: string;
}

export interface ApprovalVerifier {
  /**
   * Verify the receipt signature, approver identity, approval permission,
   * exact draft hash, and server/project scope using trusted server-side data.
   */
  verify(
    receipt: ApprovalReceipt,
    target: ApprovalTarget
  ): Promise<boolean>;
}

export interface AuditEvent {
  readonly event: "tool.denied" | "tool.started" | "tool.succeeded" | "tool.failed";
  readonly toolId: string;
  readonly actorId: string;
  readonly serverInstanceId: string;
  readonly projectId?: string;
  readonly timestamp: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}
