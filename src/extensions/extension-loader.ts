import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  readonly requiredPermissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

export interface LoadedToolBinding {
  readonly id: string;
  readonly implementationId: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly effect: ToolEffect;
  readonly risk: RiskLevel;
  readonly requiredPermissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

export interface ExtensionCandidate {
  readonly status: "candidate";
  readonly rootDirectory: string;
  /** SHA-256 hash computed by the loader from the manifest and referenced skill files. */
  readonly packageHash: string;
  readonly manifest: ExtensionManifest;
  readonly skills: readonly LoadedSkill[];
  readonly toolBindings: readonly LoadedToolBinding[];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as unknown as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
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

    // Hash only files the declarative loader actually consumes.
    const packageFiles = new Map<string, string>([["extension.json", manifestText]]);

    const entrypointContent = await this.readPackageFile(root, manifest.entrypoint.file);
    packageFiles.set(manifest.entrypoint.file, entrypointContent);

    const skills: LoadedSkill[] = [];

    for (const skill of manifest.skills) {
      const instruction = await this.readPackageFile(root, skill.instruction_file);
      packageFiles.set(skill.instruction_file, instruction);

      skills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instruction,
        allowedTools: [...skill.allowed_tools],
        requiredPermissions: [...skill.required_permissions],
        requiredCapabilities: [...skill.required_capabilities]
      });
    }

    const packageDigest = createHash("sha256");
    for (const [filePath, contents] of [...packageFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      packageDigest.update(filePath, "utf8");
      packageDigest.update("\\0", "utf8");
      packageDigest.update(contents, "utf8");
      packageDigest.update("\\0", "utf8");
    }
    const packageHash = `sha256:${packageDigest.digest("hex")}`;

    const immutableManifest = deepFreeze(structuredClone(manifest));
    const immutableSkills = deepFreeze(skills);
    const immutableBindings = deepFreeze(
      manifest.tools.map((binding) => ({
        id: binding.id,
        implementationId: binding.implementation,
        description: binding.description,
        inputSchema: structuredClone(binding.input_schema),
        effect: binding.effect,
        risk: binding.risk,
        requiredPermissions: [...binding.required_permissions],
        requiredCapabilities: [...binding.required_capabilities]
      }))
    );

    return Object.freeze({
      status: "candidate" as const,
      rootDirectory: root,
      packageHash,
      manifest: immutableManifest,
      skills: immutableSkills,
      toolBindings: immutableBindings
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

      if (
        !sameStringSet(skill.required_permissions, [...allowedPermissions]) ||
        !sameStringSet(skill.required_capabilities, [...allowedCapabilities])
      ) {
        throw new ExtensionLoadError(
          `Skill ${skill.id} permission and capability declarations must exactly match its allowed tools.`
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

    const allUsedCapabilities = new Set([
      ...manifest.skills.flatMap((skill) => skill.required_capabilities),
      ...manifest.tools.flatMap((tool) => tool.required_capabilities)
    ]);
    const unusedCapabilities = manifest.capabilities_required.filter(
      (capability) => !allUsedCapabilities.has(capability)
    );

    if (unusedCapabilities.length > 0) {
      throw new ExtensionLoadError(
        `Extension requests unused capability/capabilities: ${unusedCapabilities.join(", ")}`
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

    const maxBytes = relativePath.endsWith(".json") ? 512 * 1024 : 128 * 1024;
    if (fileStat.size > maxBytes) {
      throw new ExtensionLoadError(
        `Extension file exceeds the ${maxBytes}-byte limit: ${relativePath}`
      );
    }

    return readFile(resolvedFile, "utf8");
  }
}
