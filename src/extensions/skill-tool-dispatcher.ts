import { SampAiError } from "../core/errors.js";
import { ToolExecutor } from "../core/tool-executor.js";
import type { ExecutionContext } from "../shared/contracts.js";
import { SkillRegistry } from "./skill-registry.js";

/** Executes a tool only through the allowlist of an enabled skill. */
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

    const declared = enabledSkill.skill;
    const manifestSkill = enabledSkill.skill;
    void declared;
    void manifestSkill;

    return this.tools.executeImplementation<TOutput>(
      binding.implementationId,
      input,
      context
    );
  }
}
