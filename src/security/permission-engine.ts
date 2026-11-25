import { AuthorizationError } from "../core/errors.js";
import type {
  ApprovalVerifier,
  ExecutionContext,
  ToolDefinition
} from "../shared/contracts.js";

const HIGH_RISK = new Set(["high", "critical"]);
const DESTRUCTIVE_EFFECTS = new Set(["delete", "publish", "execute"]);

export class PermissionEngine {
  constructor(private readonly approvalVerifier: ApprovalVerifier) {}

  async assertAuthorized(
    tool: ToolDefinition,
    context: ExecutionContext
  ): Promise<void> {
    const missingPermissions = tool.requiredPermissions.filter(
      (permission) => !context.actor.permissions.includes(permission)
    );

    if (missingPermissions.length > 0) {
      throw new AuthorizationError(
        `Missing permission(s): ${missingPermissions.join(", ")}`,
        "PERMISSION_DENIED"
      );
    }

    const missingCapabilities = tool.requiredCapabilities.filter(
      (capability) => !context.adapterCapabilities.includes(capability)
    );

    if (missingCapabilities.length > 0) {
      throw new AuthorizationError(
        `Adapter does not provide: ${missingCapabilities.join(", ")}`,
        "CAPABILITY_UNAVAILABLE"
      );
    }

    this.assertAutonomyAllows(tool, context);

    const requiresApproval =
      HIGH_RISK.has(tool.risk) ||
      DESTRUCTIVE_EFFECTS.has(tool.effect) ||
      (tool.effect === "mutate" && context.autonomy === "apply_with_approval");

    if (!requiresApproval) {
      return;
    }

    const receipt = context.approval;
    const draftHash = context.draftHash;

    if (!receipt || !draftHash) {
      throw new AuthorizationError(
        "This operation requires approval for the exact draft revision.",
        "APPROVAL_REQUIRED"
      );
    }

    const matchesTarget =
      receipt.toolId === tool.id &&
      receipt.draftHash === draftHash &&
      receipt.serverInstanceId === context.serverInstanceId &&
      (receipt.projectId ?? undefined) === (context.projectId ?? undefined);

    if (!matchesTarget) {
      throw new AuthorizationError(
        "Approval does not match this tool, draft, server, or project.",
        "APPROVAL_INVALID"
      );
    }

    const verified = await this.approvalVerifier.verify(receipt, {
      toolId: tool.id,
      draftHash,
      serverInstanceId: context.serverInstanceId,
      ...(context.projectId ? { projectId: context.projectId } : {})
    });

    if (!verified) {
      throw new AuthorizationError(
        "Approval receipt could not be verified.",
        "APPROVAL_INVALID"
      );
    }
  }

  private assertAutonomyAllows(
    tool: ToolDefinition,
    context: ExecutionContext
  ): void {
    if (tool.effect === "read") {
      return;
    }

    if (tool.effect === "draft") {
      if (context.autonomy === "observe" || context.autonomy === "suggest") {
        throw new AuthorizationError(
          "Current autonomy level does not permit creating drafts.",
          "AUTONOMY_RESTRICTED"
        );
      }

      if (context.autonomy === "restricted_automation") {
        const isAllowlisted =
          context.autoAllowedToolIds?.includes(tool.id) === true;

        if (!isAllowlisted || tool.risk !== "low") {
          throw new AuthorizationError(
            "Draft tool is not eligible for restricted automation.",
            "AUTONOMY_RESTRICTED"
          );
        }
      }

      return;
    }

    if (
      context.autonomy === "observe" ||
      context.autonomy === "suggest" ||
      context.autonomy === "draft_only"
    ) {
      throw new AuthorizationError(
        "Current autonomy level does not permit server mutations.",
        "AUTONOMY_RESTRICTED"
      );
    }

    if (context.autonomy === "restricted_automation") {
      const isAllowlisted =
        context.autoAllowedToolIds?.includes(tool.id) === true;
      const isLowRisk = tool.risk === "low";
      const isNonDestructive = tool.effect === "mutate";

      if (!isAllowlisted || !isLowRisk || !isNonDestructive) {
        // High-impact actions still require a verified approval receipt.
        if (
          HIGH_RISK.has(tool.risk) ||
          DESTRUCTIVE_EFFECTS.has(tool.effect)
        ) {
          return;
        }

        throw new AuthorizationError(
          "Tool is not eligible for restricted automation.",
          "AUTONOMY_RESTRICTED"
        );
      }
    }
  }
}
