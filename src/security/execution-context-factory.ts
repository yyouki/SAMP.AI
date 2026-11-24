import { SampAiError } from "../core/errors.js";
import type {
  ActorIdentity,
  AutonomyMode,
  ExecutionContext
} from "../shared/contracts.js";
import { AdapterRegistry } from "../adapters/adapter-registry.js";

export interface TrustedRequestPrincipal {
  /** Identity established by an authenticated HTTP/WebSocket middleware. */
  readonly subject: string;
}

export interface ActorPermissionResolver {
  resolve(
    actorId: string,
    serverInstanceId: string,
    projectId?: string
  ): Promise<ActorIdentity>;
}

export interface AutonomyPolicy {
  readonly mode: AutonomyMode;
  readonly autoAllowedToolIds: readonly string[];
}

export interface AutonomyPolicyResolver {
  resolve(
    actorId: string,
    serverInstanceId: string,
    projectId?: string
  ): Promise<AutonomyPolicy>;
}

/**
 * Builds execution contexts from trusted identity, server policy, and live adapter capabilities.
 * Do not call this with identity or permissions supplied by an AI model or game client payload.
 */
export class ExecutionContextFactory {
  constructor(
    private readonly adapters: AdapterRegistry,
    private readonly actors: ActorPermissionResolver,
    private readonly autonomy: AutonomyPolicyResolver
  ) {}

  async create(
    principal: TrustedRequestPrincipal,
    serverInstanceId: string,
    projectId?: string
  ): Promise<ExecutionContext> {
    if (!principal.subject.trim() || !serverInstanceId.trim()) {
      throw new SampAiError(
        "Authenticated principal and server scope are required.",
        "TRUSTED_IDENTITY_REQUIRED"
      );
    }

    const [actor, policy, capabilities] = await Promise.all([
      this.actors.resolve(principal.subject, serverInstanceId, projectId),
      this.autonomy.resolve(principal.subject, serverInstanceId, projectId),
      Promise.resolve(this.adapters.getServerCapabilities(serverInstanceId))
    ]);

    if (actor.id !== principal.subject) {
      throw new SampAiError(
        "Permission resolver returned an identity different from the authenticated principal.",
        "ACTOR_IDENTITY_MISMATCH"
      );
    }

    return Object.freeze({
      actor: Object.freeze({
        id: actor.id,
        permissions: Object.freeze([...actor.permissions])
      }),
      serverInstanceId,
      ...(projectId ? { projectId } : {}),
      adapterCapabilities: Object.freeze([...capabilities]),
      autonomy: policy.mode,
      autoAllowedToolIds: Object.freeze([...policy.autoAllowedToolIds])
    });
  }
}
