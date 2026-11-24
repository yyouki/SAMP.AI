import { SampAiError } from "../core/errors.js";
import { ToolExecutor } from "../core/tool-executor.js";
import type { ExecutionContext } from "../shared/contracts.js";
import { SkillRegistry } from "./skill-registry.js";

/** Executes a tool only through the allowlist and grants of an enabled skill. */
export class SkillToolDispatcher {
  constructor(
    private readonly skills: SkillRegistry,
    private readonly tools: ToolExecutor
  ) {}

  execute<TOutput = unknown>(
    extensionId: string,
    skillId: string,
    toolBindingId: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<TOutput> {
    const enabledSkill = this.skills.resolveEnabledSkill(
      extensionId,
      skillId,
      context.serverInstanceId
    );

    if (!enabledSkill.skill.allowedTools.includes(toolBindingId)) {
      throw new SampAiError(
        `Tool is not allowed for skill ${skillId}: ${toolBindingId}`,
        "SKILL_TOOL_NOT_ALLOWED"
      );
    }

    const binding = enabledSkill.toolBindings.find(
      (entry) => entry.id === toolBindingId
    );

    if (!binding) {
      throw new SampAiError(
        `Tool binding is missing from extension: ${toolBindingId}`,
        "EXTENSION_TOOL_BINDING_NOT_FOUND"
      );
    }

    const missingExtensionGrants = binding.requiredPermissions.filter(
      (permission) => !enabledSkill.grantedPermissions.includes(permission)
    );

    if (missingExtensionGrants.length > 0) {
      throw new SampAiError(
        `Extension permission not granted: ${missingExtensionGrants.join(", ")}`,
        "EXTENSION_PERMISSION_NOT_GRANTED"
      );
    }

    const missingCapabilities = enabledSkill.skill.requiredCapabilities.filter(
      (capability) => !context.adapterCapabilities.includes(capability)
    );

    if (missingCapabilities.length > 0) {
      throw new SampAiError(
        `Adapter capability unavailable for skill: ${missingCapabilities.join(", ")}`,
        "CAPABILITY_UNAVAILABLE"
      );
    }

    return this.tools.executeImplementation<TOutput>(
      binding.implementationId,
      input,
      context
    );
  }
}
