import { SampAiError } from "../core/errors.js";
import { ProtocolValidator } from "../protocol/protocol-validator.js";

export interface AuthenticatedAdapterIdentity {
  /** Stable adapter identity supplied by trusted transport authentication. */
  readonly adapterId: string;
  /** Server scope bound to the adapter credential, not copied from an untrusted client field. */
  readonly serverInstanceId: string;
}

export interface RegisteredAdapter {
  readonly adapterId: string;
  readonly serverInstanceId: string;
  readonly protocol: string;
  readonly name: string;
  readonly version: string;
  readonly runtime: string;
  readonly runtimeVersion?: string;
  readonly capabilities: readonly string[];
  readonly limits: {
    readonly maxOperationsPerBatch: number;
    readonly maxObjectsPerProject: number;
  };
  readonly connectedAt: string;
  readonly lastSeenAt: string;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, RegisteredAdapter>();

  constructor(
    private readonly protocol: ProtocolValidator,
    private readonly supportedProtocols: readonly string[] = ["sampai/0.1"]
  ) {}

  registerHello(
    input: unknown,
    authenticatedIdentity: AuthenticatedAdapterIdentity
  ): RegisteredAdapter {
    if (!authenticatedIdentity.adapterId.trim() || !authenticatedIdentity.serverInstanceId.trim()) {
      throw new SampAiError(
        "Authenticated adapter and server identifiers must be non-empty.",
        "ADAPTER_IDENTITY_INVALID"
      );
    }

    const hello = this.protocol.validateAdapterHello(input);

    // Bind protocol claims to identity established by the trusted transport layer.
    if (hello.server_instance_id !== authenticatedIdentity.serverInstanceId) {
      throw new SampAiError(
        "Adapter hello server identity does not match its authenticated credential.",
        "ADAPTER_IDENTITY_MISMATCH"
      );
    }

    if (hello.payload.adapter.name !== authenticatedIdentity.adapterId) {
      throw new SampAiError(
        "Adapter name does not match its authenticated adapter identity.",
        "ADAPTER_IDENTITY_MISMATCH"
      );
    }

    if (!this.supportedProtocols.includes(hello.protocol)) {
      throw new SampAiError(
        `Unsupported adapter protocol version: ${hello.protocol}`,
        "PROTOCOL_VERSION_UNSUPPORTED"
      );
    }

    const now = new Date().toISOString();
    const key = this.getKey(
      authenticatedIdentity.serverInstanceId,
      authenticatedIdentity.adapterId
    );
    const existing = this.adapters.get(key);

    const registered: RegisteredAdapter = Object.freeze({
      adapterId: authenticatedIdentity.adapterId,
      serverInstanceId: authenticatedIdentity.serverInstanceId,
      protocol: hello.protocol,
      name: hello.payload.adapter.name,
      version: hello.payload.adapter.version,
      runtime: hello.payload.adapter.runtime,
      ...(hello.payload.adapter.runtime_version
        ? { runtimeVersion: hello.payload.adapter.runtime_version }
        : {}),
      capabilities: Object.freeze([...hello.payload.capabilities]),
      limits: Object.freeze({
        maxOperationsPerBatch: hello.payload.limits.max_operations_per_batch,
        maxObjectsPerProject: hello.payload.limits.max_objects_per_project
      }),
      connectedAt: existing?.connectedAt ?? now,
      lastSeenAt: now
    });

    // A new hello from the same authenticated adapter replaces its prior capability snapshot.
    this.adapters.set(key, registered);
    return registered;
  }

  getAdapter(
    serverInstanceId: string,
    adapterId: string
  ): RegisteredAdapter {
    const adapter = this.adapters.get(this.getKey(serverInstanceId, adapterId));

    if (!adapter) {
      throw new SampAiError(
        `Adapter is not connected: ${adapterId}`,
        "ADAPTER_NOT_CONNECTED"
      );
    }

    return adapter;
  }

  getServerCapabilities(serverInstanceId: string): readonly string[] {
    const connected = [...this.adapters.values()].filter(
      (adapter) => adapter.serverInstanceId === serverInstanceId
    );

    if (connected.length === 0) {
      throw new SampAiError(
        `No authenticated adapter is connected for server: ${serverInstanceId}`,
        "ADAPTER_NOT_CONNECTED"
      );
    }

    return Object.freeze([
      ...new Set(connected.flatMap((adapter) => adapter.capabilities))
    ]);
  }

  assertCapabilities(
    serverInstanceId: string,
    requiredCapabilities: readonly string[]
  ): void {
    const available = new Set(this.getServerCapabilities(serverInstanceId));
    const missing = requiredCapabilities.filter(
      (capability) => !available.has(capability)
    );

    if (missing.length > 0) {
      throw new SampAiError(
        `Server adapters do not provide: ${missing.join(", ")}`,
        "CAPABILITY_UNAVAILABLE"
      );
    }
  }

  touch(
    serverInstanceId: string,
    adapterId: string
  ): RegisteredAdapter {
    const current = this.getAdapter(serverInstanceId, adapterId);
    const updated = Object.freeze({
      ...current,
      lastSeenAt: new Date().toISOString()
    });
    this.adapters.set(this.getKey(serverInstanceId, adapterId), updated);
    return updated;
  }

  unregister(serverInstanceId: string, adapterId: string): boolean {
    return this.adapters.delete(this.getKey(serverInstanceId, adapterId));
  }

  list(serverInstanceId?: string): readonly RegisteredAdapter[] {
    const records = [...this.adapters.values()].filter(
      (adapter) =>
        serverInstanceId === undefined ||
        adapter.serverInstanceId === serverInstanceId
    );

    return Object.freeze(records);
  }

  private getKey(serverInstanceId: string, adapterId: string): string {
    return `${serverInstanceId}::${adapterId}`;
  }
}
