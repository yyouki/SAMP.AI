import { SampAiError } from "../core/errors.js";
import type {
  ExtensionCandidate,
  LoadedSkill,
  LoadedToolBinding
} from "./extension-loader.js";

export interface ExtensionReviewRequest {
  readonly extensionId: string;
  readonly packageHash: string;
  readonly reviewerId: string;
  readonly reviewToken: string;
}

export interface ExtensionEnablementRequest {
  readonly extensionId: string;
  readonly packageHash: string;
  readonly serverInstanceId: string;
  readonly ownerId: string;
  readonly grantedPermissions: readonly string[];
  readonly enablementToken: string;
}

export interface ExtensionReviewVerifier {
  verify(request: ExtensionReviewRequest): Promise<boolean>;
}

export interface ExtensionEnablementVerifier {
  verify(request: ExtensionEnablementRequest): Promise<boolean>;
}

export interface EnabledSkill {
  readonly extensionId: string;
  readonly packageHash: string;
  readonly serverInstanceId: string;
  readonly skill: LoadedSkill;
  readonly toolBindings: readonly LoadedToolBinding[];
  readonly grantedPermissions: readonly string[];
}

interface ExtensionRecord {
  readonly candidate: ExtensionCandidate;
  readonly packageHash: string;
  reviewedBy?: string;
  readonly enabledServers: Map<string, {
    readonly enabledBy: string;
    readonly grantedPermissions: readonly string[];
    readonly enabledAt: string;
  }>;
}

/**
 * In-memory reference implementation. Production deployments need persistent,
 * transactional storage and cryptographically verified review/enablement tokens.
 */
export class SkillRegistry {
  private readonly extensions = new Map<string, ExtensionRecord>();

  constructor(
    private readonly reviewVerifier: ExtensionReviewVerifier,
    private readonly enablementVerifier: ExtensionEnablementVerifier
  ) {}

  registerCandidate(
    candidate: ExtensionCandidate,
    packageHash: string
  ): void {
    if (!/^(sha256:)?[a-f0-9]{64}$/i.test(packageHash)) {
      throw new SampAiError(
        "Extension package hash must be a SHA-256 hex digest.",
        "PACKAGE_HASH_INVALID"
      );
    }

    const existing = this.extensions.get(candidate.manifest.id);
    if (existing) {
      if (existing.packageHash === packageHash) {
        return; // Idempotent registration of the same candidate package.
      }

      throw new SampAiError(
        "An extension with this ID is already registered; updates require a new version/review.",
        "EXTENSION_ID_CONFLICT"
      );
    }

    this.extensions.set(candidate.manifest.id, {
      candidate,
      packageHash,
      enabledServers: new Map()
    });
  }

  async approveCandidate(
    extensionId: string,
    reviewerId: string,
    reviewToken: string
  ): Promise<void> {
    const record = this.getRecord(extensionId);

    if (record.reviewedBy) {
      throw new SampAiError(
        "This extension candidate has already been reviewed.",
        "EXTENSION_ALREADY_REVIEWED"
      );
    }

    const verified = await this.reviewVerifier.verify({
      extensionId,
      packageHash: record.packageHash,
      reviewerId,
      reviewToken
    });

    if (!verified) {
      throw new SampAiError(
        "Maintainer review could not be verified.",
        "EXTENSION_REVIEW_INVALID"
      );
    }

    record.reviewedBy = reviewerId;
  }

  async enableForServer(
    extensionId: string,
    serverInstanceId: string,
    ownerId: string,
    grantedPermissions: readonly string[],
    enablementToken: string
  ): Promise<void> {
    const record = this.getRecord(extensionId);

    if (!record.reviewedBy) {
      throw new SampAiError(
        "Extension requires maintainer review before activation.",
        "EXTENSION_REVIEW_REQUIRED"
      );
    }

    if (record.enabledServers.has(serverInstanceId)) {
      throw new SampAiError(
        "Extension is already enabled for this server.",
        "EXTENSION_ALREADY_ENABLED"
      );
    }

    const requested = new Set(record.candidate.manifest.permissions_requested);
    const invalidGrants = grantedPermissions.filter(
      (permission) => !requested.has(permission)
    );

    if (invalidGrants.length > 0) {
      throw new SampAiError(
        `Cannot grant undeclared extension permission(s): ${invalidGrants.join(", ")}`,
        "EXTENSION_PERMISSION_ESCALATION"
      );
    }

    const normalizedGrants = [...new Set(grantedPermissions)].sort();

    const verified = await this.enablementVerifier.verify({
      extensionId,
      packageHash: record.packageHash,
      serverInstanceId,
      ownerId,
      grantedPermissions: normalizedGrants,
      enablementToken
    });

    if (!verified) {
      throw new SampAiError(
        "Server-owner enablement could not be verified.",
        "EXTENSION_ENABLEMENT_INVALID"
      );
    }

    record.enabledServers.set(serverInstanceId, {
      enabledBy: ownerId,
      grantedPermissions: Object.freeze(normalizedGrants),
      enabledAt: new Date().toISOString()
    });
  }

  disableForServer(extensionId: string, serverInstanceId: string): boolean {
    const record = this.getRecord(extensionId);
    return record.enabledServers.delete(serverInstanceId);
  }

  resolveEnabledSkill(
    extensionId: string,
    skillId: string,
    serverInstanceId: string
  ): EnabledSkill {
    const record = this.getRecord(extensionId);
    const activation = record.enabledServers.get(serverInstanceId);

    if (!activation) {
      throw new SampAiError(
        "Extension is not enabled for this server.",
        "EXTENSION_NOT_ENABLED"
      );
    }

    const skill = record.candidate.skills.find((entry) => entry.id === skillId);

    if (!skill) {
      throw new SampAiError(
        `Skill is not part of this extension: ${skillId}`,
        "SKILL_NOT_FOUND"
      );
    }

    const missingGrants = skill.requiredPermissions.filter(
      (permission) => !activation.grantedPermissions.includes(permission)
    );

    if (missingGrants.length > 0) {
      throw new SampAiError(
        `Server has not granted required extension permission(s): ${missingGrants.join(", ")}`,
        "EXTENSION_PERMISSION_NOT_GRANTED"
      );
    }

    return Object.freeze({
      extensionId,
      packageHash: record.packageHash,
      serverInstanceId,
      skill,
      toolBindings: record.candidate.toolBindings,
      grantedPermissions: activation.grantedPermissions
    });
  }

  getState(extensionId: string): {
    readonly packageHash: string;
    readonly reviewed: boolean;
    readonly enabledServers: readonly string[];
  } {
    const record = this.getRecord(extensionId);

    return Object.freeze({
      packageHash: record.packageHash,
      reviewed: Boolean(record.reviewedBy),
      enabledServers: Object.freeze([...record.enabledServers.keys()])
    });
  }

  private getRecord(extensionId: string): ExtensionRecord {
    const record = this.extensions.get(extensionId);

    if (!record) {
      throw new SampAiError(
        `Extension is not registered: ${extensionId}`,
        "EXTENSION_NOT_FOUND"
      );
    }

    return record;
  }
}
