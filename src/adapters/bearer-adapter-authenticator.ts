import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthenticatedAdapterIdentity } from "./adapter-registry.js";

interface StoredCredential {
  readonly digest: Buffer;
  readonly identity: AuthenticatedAdapterIdentity;
}

/**
 * Development authenticator. Store only token digests in memory.
 * Production deployments should load credentials from a secret manager or database.
 */
export class InMemoryBearerAdapterAuthenticator {
  private readonly credentials: StoredCredential[] = [];

  addCredential(
    token: string,
    identity: AuthenticatedAdapterIdentity
  ): void {
    if (token.length < 32) {
      throw new Error("Adapter bearer tokens must contain at least 32 characters.");
    }

    if (!identity.adapterId.trim() || !identity.serverInstanceId.trim()) {
      throw new Error("Adapter identity fields must be non-empty.");
    }

    const digest = createHash("sha256").update(token, "utf8").digest();
    const duplicate = this.credentials.some((credential) =>
      timingSafeEqual(credential.digest, digest)
    );

    if (duplicate) {
      throw new Error("This adapter bearer token is already registered.");
    }

    this.credentials.push({
      digest,
      identity: Object.freeze({
        adapterId: identity.adapterId,
        serverInstanceId: identity.serverInstanceId
      })
    });
  }

  async authenticate(
    authorizationHeader: string | undefined
  ): Promise<AuthenticatedAdapterIdentity | undefined> {
    if (!authorizationHeader) return undefined;

    const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(authorizationHeader);
    if (!match?.[1]) return undefined;

    const digest = createHash("sha256").update(match[1], "utf8").digest();

    // Compare every stored digest to reduce token-position timing differences.
    let matched: AuthenticatedAdapterIdentity | undefined;
    for (const credential of this.credentials) {
      const equal = timingSafeEqual(credential.digest, digest);
      if (equal) matched = credential.identity;
    }

    return matched;
  }

  revokeCredential(token: string): boolean {
    const digest = createHash("sha256").update(token, "utf8").digest();
    const index = this.credentials.findIndex((credential) =>
      timingSafeEqual(credential.digest, digest)
    );

    if (index < 0) return false;
    this.credentials.splice(index, 1);
    return true;
  }
}
