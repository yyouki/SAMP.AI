import { readFile, realpath, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ExtensionLoadError } from "../core/errors.js";
import { ToolRegistry } from "../core/tool-registry.js";
import { JsonSchemaValidator } from "../validation/json-schema-validator.js";
import type {
  CompensationStrategy,
  JsonSchema,
  RiskLevel,
  ToolEffect
} from "../shared/contracts.js";

interface ExtensionToolBinding {
  id: string;
  description: string;
  implementation: string;
  effect: ToolEffect;
  risk: RiskLevel;
  required_permissions: string[];
  required_capabilities: string[];
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  timeout_ms: number;
  idempotent: boolean;
  compensation: CompensationStrategy;
}

interface ExtensionSkill {
  id: string;
  name: string;
  description: string;
  instruction_file: string;
  allowed_tools: string[];
  required_permissions: string[];
  required_capabilities: string[];
  triggers: string[];
  default_mode: "read_only" | "draft_only";
  output_contract: string;
}

interface ExtensionManifest {
  manifest_version: "1.0";
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: { name: string; url?: string; contact?: string };
  license: string;
  compatibility: {
    samp_ai_core: string;
    protocol_versions: string[];
    adapters?: string[];
  };
  entrypoint: { kind: "declarative"; file: string };
  skills: ExtensionSkill[];
  tools: ExtensionToolBinding[];
  permissions_requested: string[];
  capabilities_required: string[];
  data_access: string[];
  network: { outbound: boolean; allowed_hosts: string[]; reason: string };
  resources: {
    max_tool_calls_per_run: number;
    max_run_seconds: number;
    max_context_kb: number;
  };
  tags?: string[];
}

export interface LoadedSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly allowedTools: readonly string[];
}

export interface LoadedToolBinding {
  readonly id: string;
  readonly implementationId: string;
}

export interface ExtensionCandidate {
  readonly status: "candidate";
  readonly rootDirectory: string;
  readonly manifest: ExtensionManifest;
  readonly skills: readonly LoadedSkill[];
  readonly toolBindings: readonly LoadedToolBinding[];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value));
}

export class ExtensionLoader {
  constructor(
    private readonly schemas: JsonSchemaValidator,
    private readonly tools: ToolRegistry
  ) {}

  async loadCandidate(packageDirectory: string): Promise<ExtensionCandidate> {
    const root = await realpath(packageDirectory);
    const manifestText = await this.readPackageFile(root, "extension.json");

    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(manifestText) as unknown;
    } catch {
      throw new ExtensionLoadError("extension.json is not valid JSON.");
    }

    const manifest = this.schemas.assert<ExtensionManifest>(
      "https://raw.githubusercontent.com/yyouki/SAMP.AI/main/schemas/extensions/manifest.schema.json",
      rawManifest,
      "extension manifest"
    );

    this.assertUniqueIds(manifest);
    this.assertPermissionAndCapabilityDeclarations(manifest);
    this.assertToolBindings(manifest);

    // The entrypoint is checked even though skills are loaded individually.
    await this.readPackageFile(root, manifest.entrypoint.file);

    const skills: LoadedSkill[] = [];

    for (const skill of manifest.skills) {
      const instruction = await this.readPackageFile(root, skill.instruction_file);

      skills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instruction,
        allowedTools: [...skill.allowed_tools]
      });
    }

    return Object.freeze({
      status: "candidate" as const,
      rootDirectory: root,
      manifest,
      skills: Object.freeze(skills),
      toolBindings: Object.freeze(
        manifest.tools.map((binding) => ({
          id: binding.id,
          implementationId: binding.implementation
        }))
      )
    });
  }

  private assertUniqueIds(manifest: ExtensionManifest): void {
    const skillIds = manifest.skills.map((skill) => skill.id);
    const toolIds = manifest.tools.map((tool) => tool.id);

    if (new Set(skillIds).size !== skillIds.length) {
      throw new ExtensionLoadError("Extension contains duplicate skill IDs.");
    }

    if (new Set(toolIds).size !== toolIds.length) {
      throw new ExtensionLoadError("Extension contains duplicate tool binding IDs.");
    }
  }

  private assertPermissionAndCapabilityDeclarations(
    manifest: ExtensionManifest
  ): void {
    const requestedPermissions = new Set(manifest.permissions_requested);
    const requiredCapabilities = new Set(manifest.capabilities_required);

    for (const tool of manifest.tools) {
      for (const permission of tool.required_permissions) {
        if (!requestedPermissions.has(permission)) {
          throw new ExtensionLoadError(
            `Tool binding ${tool.id} uses undeclared permission: ${permission}`
          );
        }
      }

      for (const capability of tool.required_capabilities) {
        if (!requiredCapabilities.has(capability)) {
          throw new ExtensionLoadError(
            `Tool binding ${tool.id} uses undeclared capability: ${capability}`
          );
        }
      }
    }

    for (const skill of manifest.skills) {
      for (const permission of skill.required_permissions) {
        if (!requestedPermissions.has(permission)) {
          throw new ExtensionLoadError(
            `Skill ${skill.id} uses undeclared permission: ${permission}`
          );
        }
      }

      for (const capability of skill.required_capabilities) {
        if (!requiredCapabilities.has(capability)) {
          throw new ExtensionLoadError(
            `Skill ${skill.id} uses undeclared capability: ${capability}`
          );
        }
      }

      const allowedBindings = manifest.tools.filter((binding) =>
        skill.allowed_tools.includes(binding.id)
      );
      const allowedPermissions = new Set(
        allowedBindings.flatMap((binding) => binding.required_permissions)
      );
      const allowedCapabilities = new Set(
        allowedBindings.flatMap((binding) => binding.required_capabilities)
      );

      const unusedSkillPermissions = skill.required_permissions.filter(
        (permission) => !allowedPermissions.has(permission)
      );
      const unusedSkillCapabilities = skill.required_capabilities.filter(
        (capability) => !allowedCapabilities.has(capability)
      );

      if (unusedSkillPermissions.length > 0 || unusedSkillCapabilities.length > 0) {
        throw new ExtensionLoadError(
          `Skill ${skill.id} declares permissions or capabilities not used by its allowed tools.`
        );
      }

      const missingBindings = skill.allowed_tools.filter(
        (toolId) => !manifest.tools.some((binding) => binding.id === toolId)
      );

      if (missingBindings.length > 0) {
        throw new ExtensionLoadError(
          `Skill ${skill.id} references unknown tool binding(s): ${missingBindings.join(", ")}`
        );
      }
    }

    const allUsedPermissions = new Set([
      ...manifest.skills.flatMap((skill) => skill.required_permissions),
      ...manifest.tools.flatMap((tool) => tool.required_permissions)
    ]);

    const unusedPermissions = manifest.permissions_requested.filter(
      (permission) => !allUsedPermissions.has(permission)
    );

    if (unusedPermissions.length > 0) {
      throw new ExtensionLoadError(
        `Extension requests unused permission(s): ${unusedPermissions.join(", ")}`
      );
    }
  }

  private assertToolBindings(manifest: ExtensionManifest): void {
    for (const binding of manifest.tools) {
      if (!this.tools.hasImplementation(binding.implementation)) {
        throw new ExtensionLoadError(
          `Tool implementation is not registered: ${binding.implementation}`,
          "UNKNOWN_TOOL_IMPLEMENTATION"
        );
      }

      const implementation = this.tools.getImplementation(binding.implementation);

      if (!isDeepStrictEqual(implementation.inputSchema, binding.input_schema)) {
        throw new ExtensionLoadError(
          `Tool binding ${binding.id} must use the registered implementation input schema.`
        );
      }

      if (!isDeepStrictEqual(implementation.outputSchema, binding.output_schema)) {
        throw new ExtensionLoadError(
          `Tool binding ${binding.id} must use the registered implementation output schema.`
        );
      }

      if (
        binding.timeout_ms !== implementation.timeoutMs ||
        binding.idempotent !== implementation.idempotent ||
        binding.compensation !== implementation.compensation ||
        binding.effect !== implementation.effect ||
        binding.risk !== implementation.risk ||
        !sameStringSet(binding.required_permissions, implementation.requiredPermissions) ||
        !sameStringSet(binding.required_capabilities, implementation.requiredCapabilities)
      ) {
        throw new ExtensionLoadError(
          `Tool binding ${binding.id} metadata must exactly match its registered implementation.`
        );
      }
    }
  }

  private async readPackageFile(root: string, relativePath: string): Promise<string> {
    if (isAbsolute(relativePath)) {
      throw new ExtensionLoadError("Extension paths must be relative.");
    }

    const candidate = resolve(root, relativePath);
    const lexicalRelative = relative(root, candidate);

    if (
      lexicalRelative === ".." ||
      lexicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(lexicalRelative)
    ) {
      throw new ExtensionLoadError("Extension path escapes its package directory.");
    }

    let resolvedFile: string;
    try {
      resolvedFile = await realpath(candidate);
    } catch {
      throw new ExtensionLoadError(`Extension file does not exist: ${relativePath}`);
    }

    const realRelative = relative(root, resolvedFile);

    if (
      realRelative === ".." ||
      realRelative.startsWith(`..${sep}`) ||
      isAbsolute(realRelative)
    ) {
      throw new ExtensionLoadError("Extension symlink escapes its package directory.");
    }

    const fileStat = await stat(resolvedFile);

    if (!fileStat.isFile()) {
      throw new ExtensionLoadError(`Extension path is not a file: ${relativePath}`);
    }

    return readFile(resolvedFile, "utf8");
  }
}
