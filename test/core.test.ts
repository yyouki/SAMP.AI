import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  AuthorizationError,
  JsonSchemaValidator,
  PermissionEngine,
  ToolExecutor,
  ToolRegistry,
  type ToolDefinition,
  ExtensionLoader,
  createDefaultSchemaValidator,
  registerMockAdapterTools,
  ProtocolValidator,
  AdapterRegistry,
  SkillRegistry,
  SkillToolDispatcher,
  ExecutionContextFactory,
  AgentRunner,
  InMemoryAgentConversationStore,
  type ModelProvider,
  OpenAIResponsesProvider,
  HttpAdapterGateway,
  type ApprovalReceipt,
  AdapterActionRegistry,
  AdapterTaskQueue,
  type AdapterActionDefinition,
  InMemoryBearerAdapterAuthenticator
} from "../src/index.js";

const inputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectId: { type: "string", minLength: 1 }
  },
  required: ["projectId"]
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectId: { type: "string" },
    count: { type: "integer", minimum: 0 }
  },
  required: ["projectId", "count"]
};

function createReadTool(): ToolDefinition {
  return {
    id: "project.inspect",
    implementationId: "project.inspect",
    description: "Inspect a project using read-only server context.",
    effect: "read",
    risk: "low",
    requiredPermissions: ["project.view"],
    requiredCapabilities: ["project.inspect"],
    inputSchema,
    outputSchema,
    timeoutMs: 1000,
    idempotent: true,
    compensation: "none",
    handler: async (input) => ({
      projectId: (input as { projectId: string }).projectId,
      count: 2
    })
  };
}

function createMutationTool(): ToolDefinition {
  return {
    id: "mapping.apply",
    implementationId: "mapping.apply",
    description: "Apply an approved mapping draft.",
    effect: "mutate",
    risk: "high",
    requiredPermissions: ["mapping.publish"],
    requiredCapabilities: ["mapping.apply"],
    inputSchema,
    outputSchema,
    timeoutMs: 1000,
    idempotent: false,
    compensation: "compensation",
    handler: async (input) => ({
      projectId: (input as { projectId: string }).projectId,
      count: 1
    })
  };
}

const approval: ApprovalReceipt = {
  approvalId: "approval-001",
  approvedBy: "admin-01",
  toolId: "mapping.apply",
  draftHash: "sha256:draft-001",
  serverInstanceId: "server-test",
  projectId: "hospital",
  issuedAt: "2026-11-24T00:00:00.000Z",
  signature: "test-signature"
};

function createExecutor(verifyApproval = async () => true) {
  const registry = new ToolRegistry();
  registry.register(createReadTool());
  registry.register(createMutationTool());

  const permissionEngine = new PermissionEngine({
    verify: verifyApproval
  });

  const schemas = new JsonSchemaValidator();

  // Tests use a deterministic in-memory audit sink for non-read tools.
  return new ToolExecutor(registry, permissionEngine, schemas, {
    write: async () => undefined
  });
}

test("registry rejects duplicate tool IDs", () => {
  const registry = new ToolRegistry();
  registry.register(createReadTool());

  assert.throws(() => registry.register(createReadTool()), /already registered/);
});

test("read tool runs when permissions and capabilities are present", async () => {
  const executor = createExecutor();

  const result = await executor.execute<{ projectId: string; count: number }>(
    "project.inspect",
    { projectId: "hospital" },
    {
      actor: { id: "mapper-01", permissions: ["project.view"] },
      serverInstanceId: "server-test",
      projectId: "hospital",
      adapterCapabilities: ["project.inspect"],
      autonomy: "observe"
    }
  );

  assert.deepEqual(result, { projectId: "hospital", count: 2 });
});

test("executor blocks missing permissions", async () => {
  const executor = createExecutor();

  await assert.rejects(
    executor.execute(
      "project.inspect",
      { projectId: "hospital" },
      {
        actor: { id: "guest-01", permissions: [] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["project.inspect"],
        autonomy: "observe"
      }
    ),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "PERMISSION_DENIED"
  );
});

test("executor blocks unavailable adapter capabilities", async () => {
  const executor = createExecutor();

  await assert.rejects(
    executor.execute(
      "project.inspect",
      { projectId: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["project.view"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: [],
        autonomy: "observe"
      }
    ),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "CAPABILITY_UNAVAILABLE"
  );
});

test("executor rejects malformed tool input", async () => {
  const executor = createExecutor();

  await assert.rejects(
    executor.execute(
      "project.inspect",
      { projectId: "" },
      {
        actor: { id: "mapper-01", permissions: ["project.view"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["project.inspect"],
        autonomy: "observe"
      }
    ),
    (error: unknown) =>
      error instanceof Error && error.message.includes("Invalid input")
  );
});

test("high-risk mutation requires approval for the exact draft", async () => {
  const executor = createExecutor();

  await assert.rejects(
    executor.execute(
      "mapping.apply",
      { projectId: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["mapping.publish"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["mapping.apply"],
        autonomy: "apply_with_approval",
        draftHash: "sha256:draft-001"
      }
    ),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "APPROVAL_REQUIRED"
  );
});

test("approved mutation runs only when the approval verifier accepts it", async () => {
  const executor = createExecutor(async () => true);

  const result = await executor.execute<{ projectId: string; count: number }>(
    "mapping.apply",
    { projectId: "hospital" },
    {
      actor: { id: "mapper-01", permissions: ["mapping.publish"] },
      serverInstanceId: "server-test",
      projectId: "hospital",
      adapterCapabilities: ["mapping.apply"],
      autonomy: "apply_with_approval",
      draftHash: "sha256:draft-001",
      approval
    }
  );

  assert.deepEqual(result, { projectId: "hospital", count: 1 });
});

test("invalid approval is rejected", async () => {
  const executor = createExecutor(async () => false);

  await assert.rejects(
    executor.execute(
      "mapping.apply",
      { projectId: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["mapping.publish"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["mapping.apply"],
        autonomy: "apply_with_approval",
        draftHash: "sha256:draft-001",
        approval
      }
    ),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "APPROVAL_INVALID"
  );
});

test("observe autonomy cannot create drafts", async () => {
  const registry = new ToolRegistry();
  registry.register({
    ...createReadTool(),
    id: "project.create-draft",
    implementationId: "project.create-draft",
    effect: "draft",
    handler: async () => ({ projectId: "hospital", count: 0 })
  });

  const permissionEngine = new PermissionEngine({ verify: async () => true });

  await assert.rejects(
    permissionEngine.assertAuthorized(registry.get("project.create-draft"), {
      actor: { id: "mapper-01", permissions: ["project.view"] },
      serverInstanceId: "server-test",
      adapterCapabilities: ["project.inspect"],
      autonomy: "observe"
    }),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "AUTONOMY_RESTRICTED"
  );
});


test("extension loader returns a disabled candidate using registered tool bindings", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);

  const loader = new ExtensionLoader(
    createDefaultSchemaValidator(),
    registry
  );

  const candidate = await loader.loadCandidate(
    resolve(process.cwd(), "examples/extensions/scene-auditor")
  );

  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.manifest.id, "community.scene-auditor");
  assert.equal(candidate.skills.length, 1);
  assert.equal(candidate.skills[0]?.allowedTools[0], "community.scene-auditor.inspect");
  assert.equal(candidate.packageHash.startsWith("sha256:"), true);
  assert.equal(candidate.toolBindings[0]?.id, "community.scene-auditor.inspect");
  assert.equal(candidate.toolBindings[0]?.implementationId, "mapping.inspect");
  assert.deepEqual(candidate.toolBindings[0]?.requiredPermissions, ["mapping.view"]);
  assert.deepEqual(candidate.toolBindings[0]?.requiredCapabilities, ["mapping.inspect"]);
  assert.match(candidate.skills[0]?.instruction ?? "", /Do not modify/);
});

test("extension loader rejects unknown tool implementations", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);

  const loader = new ExtensionLoader(
    createDefaultSchemaValidator(),
    registry
  );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "samp-ai-extension-"));
  const candidateDirectory = join(temporaryDirectory, "candidate");

  try {
    const sourceDirectory = resolve(process.cwd(), "examples/extensions/scene-auditor");
    await cp(sourceDirectory, candidateDirectory, { recursive: true });

    const manifestPath = join(candidateDirectory, "extension.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      tools: Array<{ implementation: string }>;
    };
    manifest.tools[0]!.implementation = "database.drop_all";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await assert.rejects(
      loader.loadCandidate(candidateDirectory),
      /Tool implementation is not registered/
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});


test("protocol validator accepts a well-formed adapter handshake", () => {
  const validator = new ProtocolValidator(createDefaultSchemaValidator());
  const hello = {
  "protocol": "sampai/0.1",
  "message_id": "hello_pawn_001",
  "type": "event",
  "server_instance_id": "server_ls_01",
  "timestamp": "2026-11-24T15:00:00Z",
  "event": "adapter.hello",
  "payload": {
    "adapter": {
      "name": "sampai-pawn",
      "version": "0.1.0",
      "runtime": "open.mp",
      "runtime_version": "reported-by-adapter"
    },
    "capabilities": [
      "context.player_position",
      "context.player_facing",
      "mapping.create_object",
      "mapping.inspect",
      "mapping.create_marker",
      "mapping.remove_marker"
    ],
    "limits": {
      "max_operations_per_batch": 20,
      "max_objects_per_project": 1000
    }
  }
};

  const result = validator.validateAdapterHello(hello);

  assert.equal(result.event, "adapter.hello");
  assert.equal(result.payload.adapter.runtime, "open.mp");
  assert.ok(result.payload.capabilities.includes("mapping.inspect"));
});

test("protocol validator rejects a request without request_id", () => {
  const validator = new ProtocolValidator(createDefaultSchemaValidator());

  assert.throws(
    () => validator.validateMessage({
      protocol: "sampai/0.1",
      message_id: "request_001",
      type: "request",
      server_instance_id: "server_ls_01",
      timestamp: "2026-11-24T15:00:00Z",
      actor: { id: "admin_01", kind: "admin" },
      action: "mapping.inspect",
      payload: {}
    }),
    /request_id/
  );
});

test("protocol validator accepts world coordinates with provenance", () => {
  const validator = new ProtocolValidator(createDefaultSchemaValidator());
  const coordinate = {
  "frame": "world",
  "position": {
    "x": 1481.2,
    "y": -1724.6,
    "z": 13.5
  },
  "rotation": {
    "x": 0,
    "y": 0,
    "z": 90
  },
  "context": {
    "interior_id": 0,
    "virtual_world_id": 0
  },
  "provenance": {
    "source": "user_selected_point",
    "adapter_method": "editor.select_point",
    "captured_at": "2026-11-24T15:00:00Z",
    "confidence": "high"
  }
};

  const result = validator.validateCoordinate<{ frame: string; provenance: { source: string } }>(coordinate);
  assert.equal(result.frame, "world");
  assert.equal(result.provenance.source, "user_selected_point");
});

test("protocol validator requires an anchor for local coordinates", () => {
  const validator = new ProtocolValidator(createDefaultSchemaValidator());

  assert.throws(
    () => validator.validateCoordinate({
      frame: "local",
      position: { x: 0, y: 0, z: 0 },
      provenance: { source: "derived_from_anchor", confidence: "high" }
    }),
    /anchor_id/
  );
});


test("executor can resolve an implementation ID for extension tool bindings", async () => {
  const registry = new ToolRegistry();
  registry.register(createReadTool());

  const executor = new ToolExecutor(
    registry,
    new PermissionEngine({ verify: async () => true }),
    new JsonSchemaValidator()
  );

  const result = await executor.executeImplementation<{ projectId: string; count: number }>(
    "project.inspect",
    { projectId: "hospital" },
    {
      actor: { id: "mapper-01", permissions: ["project.view"] },
      serverInstanceId: "server-test",
      projectId: "hospital",
      adapterCapabilities: ["project.inspect"],
      autonomy: "observe"
    }
  );

  assert.deepEqual(result, { projectId: "hospital", count: 2 });
});


test("executor identifies when a tool may have completed but final audit persistence failed", async () => {
  const registry = new ToolRegistry();
  let handlerCalled = false;
  registry.register({
    ...createReadTool(),
    handler: async (input) => {
      handlerCalled = true;
      return {
        projectId: (input as { projectId: string }).projectId,
        count: 1
      };
    }
  });

  const executor = new ToolExecutor(
    registry,
    new PermissionEngine({ verify: async () => true }),
    new JsonSchemaValidator(),
    {
      write: async (event) => {
        if (event.event === "tool.succeeded") {
          throw new Error("audit database unavailable");
        }
      }
    }
  );

  await assert.rejects(
    executor.execute(
      "project.inspect",
      { projectId: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["project.view"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["project.inspect"],
        autonomy: "observe"
      }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUDIT_PERSISTENCE_FAILED"
  );

  assert.equal(handlerCalled, true);
});


test("adapter registry binds advertised capabilities to authenticated identity", () => {
  const protocol = new ProtocolValidator(createDefaultSchemaValidator());
  const registry = new AdapterRegistry(protocol);
  const hello = {
    protocol: "sampai/0.1",
    message_id: "hello_pawn_001",
    type: "event",
    server_instance_id: "server_ls_01",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: {
        name: "sampai-pawn",
        version: "0.1.0",
        runtime: "open.mp",
        runtime_version: "1.3.1"
      },
      capabilities: ["mapping.inspect", "mapping.create_marker"],
      limits: {
        max_operations_per_batch: 20,
        max_objects_per_project: 1000
      }
    }
  };

  const adapter = registry.registerHello(hello, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server_ls_01"
  });

  assert.equal(adapter.runtime, "open.mp");
  assert.ok(registry.getServerCapabilities("server_ls_01").includes("mapping.inspect"));
  assert.doesNotThrow(() =>
    registry.assertCapabilities("server_ls_01", ["mapping.inspect"])
  );
});

test("adapter registry rejects a server identity mismatch", () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const hello = {
    protocol: "sampai/0.1",
    message_id: "hello_pawn_002",
    type: "event",
    server_instance_id: "server_other",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: {
        name: "sampai-pawn",
        version: "0.1.0",
        runtime: "open.mp"
      },
      capabilities: ["mapping.inspect"],
      limits: {
        max_operations_per_batch: 20,
        max_objects_per_project: 1000
      }
    }
  };

  assert.throws(
    () => registry.registerHello(hello, {
      adapterId: "sampai-pawn",
      serverInstanceId: "server_ls_01"
    }),
    /does not match its authenticated credential/
  );
});

test("adapter registry replaces stale capabilities on reconnect", () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const identity = {
    adapterId: "sampai-pawn",
    serverInstanceId: "server_ls_01"
  };
  const hello = (capabilities: string[]) => ({
    protocol: "sampai/0.1",
    message_id: "hello_reconnect_001",
    type: "event",
    server_instance_id: "server_ls_01",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities,
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  });

  registry.registerHello(hello(["mapping.inspect", "textdraw.create"]), identity);
  registry.registerHello(hello(["mapping.inspect"]), identity);

  assert.deepEqual(
    registry.getServerCapabilities("server_ls_01"),
    ["mapping.inspect"]
  );
});


test("skill registry requires maintainer review before server-owner enablement", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);
  const loader = new ExtensionLoader(createDefaultSchemaValidator(), registry);
  const candidate = await loader.loadCandidate(
    resolve(process.cwd(), "examples/extensions/scene-auditor")
  );

  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );

  skills.registerCandidate(candidate);

  await assert.rejects(
    skills.enableForServer(
      candidate.manifest.id,
      "server-test",
      "owner-01",
      ["mapping.view"],
      "owner-token"
    ),
    /requires maintainer review/
  );

  await skills.approveCandidate(candidate.manifest.id, "maintainer-01", "review-token");
  await skills.enableForServer(
    candidate.manifest.id,
    "server-test",
    "owner-01",
    ["mapping.view"],
    "owner-token"
  );

  assert.deepEqual(skills.getState(candidate.manifest.id).enabledServers, ["server-test"]);
});

test("skill registry rejects extension permission escalation", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);
  const candidate = await new ExtensionLoader(
    createDefaultSchemaValidator(),
    registry
  ).loadCandidate(resolve(process.cwd(), "examples/extensions/scene-auditor"));

  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );

  skills.registerCandidate(candidate);
  assert.match(candidate.packageHash, /^sha256:[a-f0-9]{64}$/);
  await skills.approveCandidate(candidate.manifest.id, "maintainer-01", "review-token");

  await assert.rejects(
    skills.enableForServer(
      candidate.manifest.id,
      "server-test",
      "owner-01",
      ["mapping.delete"],
      "owner-token"
    ),
    /Cannot grant undeclared/
  );
});

test("skill dispatcher enforces skill tool allowlist and executes implementation alias", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);
  const candidate = await new ExtensionLoader(
    createDefaultSchemaValidator(),
    registry
  ).loadCandidate(resolve(process.cwd(), "examples/extensions/scene-auditor"));

  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );

  skills.registerCandidate(candidate);
  await skills.approveCandidate(candidate.manifest.id, "maintainer-01", "review-token");
  await skills.enableForServer(
    candidate.manifest.id,
    "server-test",
    "owner-01",
    ["mapping.view"],
    "owner-token"
  );

  const executor = new ToolExecutor(
    registry,
    new PermissionEngine({ verify: async () => true }),
    new JsonSchemaValidator()
  );
  const dispatcher = new SkillToolDispatcher(skills, executor);

  const result = await dispatcher.execute(
    candidate.manifest.id,
    "community.scene-auditor.review",
    "community.scene-auditor.inspect",
    { project_id: "hospital" },
    {
      actor: { id: "mapper-01", permissions: ["mapping.view"] },
      serverInstanceId: "server-test",
      projectId: "hospital",
      adapterCapabilities: ["mapping.inspect"],
      autonomy: "observe"
    }
  );

  assert.deepEqual(result, {
    project_id: "hospital",
    objects: [],
    truncated: false
  });

  await assert.rejects(
    async () => dispatcher.execute(
      candidate.manifest.id,
      "community.scene-auditor.review",
      "mapping.delete",
      { project_id: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["mapping.view"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["mapping.inspect"],
        autonomy: "observe"
      }
    ),
    /not allowed for skill/
  );
});


test("execution context factory uses backend permissions and registered adapter capabilities", async () => {
  const adapterRegistry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );

  adapterRegistry.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_factory_001",
    type: "event",
    server_instance_id: "server-factory",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: {
        name: "sampai-pawn",
        version: "0.1.0",
        runtime: "open.mp"
      },
      capabilities: ["mapping.inspect", "mapping.create_marker"],
      limits: {
        max_operations_per_batch: 20,
        max_objects_per_project: 1000
      }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server-factory"
  });

  const factory = new ExecutionContextFactory(
    adapterRegistry,
    {
      resolve: async (actorId) => ({
        id: actorId,
        permissions: ["mapping.view", "mapping.create"]
      })
    },
    {
      resolve: async () => ({
        mode: "apply_with_approval",
        autoAllowedToolIds: []
      })
    }
  );

  const context = await factory.create(
    { subject: "admin-42" },
    "server-factory",
    "city-project",
    { draftHash: approval.draftHash, approval }
  );

  assert.deepEqual(context.actor.permissions, ["mapping.view", "mapping.create"]);
  assert.ok(context.adapterCapabilities.includes("mapping.inspect"));
  assert.equal(context.projectId, "city-project");
  assert.equal(context.draftHash, approval.draftHash);
  assert.equal(context.approval?.approvalId, "approval-001");
  assert.equal(context.autonomy, "apply_with_approval");
});

test("execution context factory rejects an actor resolver identity mismatch", async () => {
  const adapterRegistry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  adapterRegistry.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_factory_002",
    type: "event",
    server_instance_id: "server-factory",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.inspect"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server-factory"
  });

  const factory = new ExecutionContextFactory(
    adapterRegistry,
    { resolve: async () => ({ id: "different-user", permissions: ["ai.use", "mapping.view"] }) },
    { resolve: async () => ({ mode: "observe", autoAllowedToolIds: [] }) }
  );

  await assert.rejects(
    factory.create({ subject: "admin-42" }, "server-factory"),
    /different from the authenticated principal/
  );
});


test("non-read tool execution requires an audit sink", async () => {
  const registry = new ToolRegistry();
  registry.register({
    ...createReadTool(),
    id: "project.prepare-draft",
    implementationId: "project.prepare-draft",
    effect: "draft",
    handler: async () => ({ projectId: "hospital", count: 0 })
  });

  const executor = new ToolExecutor(
    registry,
    new PermissionEngine({ verify: async () => true }),
    new JsonSchemaValidator()
  );

  await assert.rejects(
    executor.execute(
      "project.prepare-draft",
      { projectId: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["project.view"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["project.inspect"],
        autonomy: "draft_only"
      }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUDIT_REQUIRED"
  );
});


test("agent runner exposes only active skill tools and executes through the skill dispatcher", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);

  const candidate = await new ExtensionLoader(
    createDefaultSchemaValidator(),
    registry
  ).loadCandidate(resolve(process.cwd(), "examples/extensions/scene-auditor"));

  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );
  skills.registerCandidate(candidate);
  await skills.approveCandidate(candidate.manifest.id, "maintainer-01", "review-token");
  await skills.enableForServer(
    candidate.manifest.id,
    "server-agent",
    "owner-01",
    ["mapping.view"],
    "owner-token"
  );

  const adapterRegistry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  adapterRegistry.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_agent_001",
    type: "event",
    server_instance_id: "server-agent",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.inspect"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server-agent"
  });

  const contexts = new ExecutionContextFactory(
    adapterRegistry,
    {
      resolve: async (actorId) => ({ id: actorId, permissions: ["ai.use", "mapping.view"] })
    },
    {
      resolve: async () => ({ mode: "observe", autoAllowedToolIds: [] })
    }
  );

  const toolExecutor = new ToolExecutor(
    registry,
    new PermissionEngine({ verify: async () => true }),
    new JsonSchemaValidator()
  );
  const dispatcher = new SkillToolDispatcher(skills, toolExecutor);
  let providerCalls = 0;
  const provider: ModelProvider = {
    complete: async (request) => {
      providerCalls += 1;
      if (providerCalls === 1) {
        assert.equal(request.tools.length, 1);
        assert.match(request.tools[0]?.name ?? "", /^samp_[a-f0-9]{24}$/);
        assert.ok(request.tools[0]?.description.includes("community.scene-auditor.inspect"));
        return {
          content: "I will inspect the project.",
          toolCalls: [{
            id: "call-01",
            name: request.tools[0]!.name,
            arguments: { project_id: "hospital" }
          }]
        };
      }

      assert.equal(request.messages.at(-1)?.role, "tool");
      return { content: "The project inspection completed." };
    }
  };

  const runner = new AgentRunner(
    provider,
    new InMemoryAgentConversationStore(),
    skills,
    dispatcher,
    contexts
  );

  const result = await runner.run({
    principal: { subject: "mapper-01" },
    serverInstanceId: "server-agent",
    projectId: "hospital",
    sessionId: "session-01",
    userMessage: "Review the hospital mapping."
  });

  assert.equal(result.response, "The project inspection completed.");
  assert.equal(result.steps, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.stoppedBecause, "completed");
});

test("agent runner cannot call a tool absent from the current enabled skill set", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);
  const candidate = await new ExtensionLoader(
    createDefaultSchemaValidator(),
    registry
  ).loadCandidate(resolve(process.cwd(), "examples/extensions/scene-auditor"));

  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );
  skills.registerCandidate(candidate);
  await skills.approveCandidate(candidate.manifest.id, "maintainer-01", "review-token");
  await skills.enableForServer(
    candidate.manifest.id,
    "server-agent-2",
    "owner-01",
    ["mapping.view"],
    "owner-token"
  );

  const adapterRegistry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  adapterRegistry.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_agent_002",
    type: "event",
    server_instance_id: "server-agent-2",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.inspect"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server-agent-2"
  });

  const contexts = new ExecutionContextFactory(
    adapterRegistry,
    { resolve: async (actorId) => ({ id: actorId, permissions: ["ai.use", "mapping.view"] }) },
    { resolve: async () => ({ mode: "observe", autoAllowedToolIds: [] }) }
  );

  const runner = new AgentRunner(
    {
      complete: async (request) => {
        const callNumber = request.messages.filter((message) => message.role === "assistant").length;
        if (callNumber === 0) {
          assert.equal(request.tools.length, 1);
          return {
            content: "I cannot run an unavailable tool.",
            toolCalls: [{
              id: "call-unknown",
              name: "database.drop_all",
              arguments: {}
            }]
          };
        }
        return { content: "That tool is not available to this session." };
      }
    },
    new InMemoryAgentConversationStore(),
    skills,
    new SkillToolDispatcher(
      skills,
      new ToolExecutor(
        registry,
        new PermissionEngine({ verify: async () => true }),
        new JsonSchemaValidator()
      )
    ),
    contexts
  );

  const result = await runner.run({
    principal: { subject: "mapper-02" },
    serverInstanceId: "server-agent-2",
    sessionId: "session-02",
    userMessage: "Delete the database."
  });

  assert.equal(result.toolCalls, 1);
  assert.ok(result.response.includes("not available") || result.response.includes("unavailable") || result.response.includes("cannot"));
});


test("agent runner requires ai.use before calling a model provider", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);
  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );
  const adapterRegistry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  adapterRegistry.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_ai_permission",
    type: "event",
    server_instance_id: "server-ai-permission",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.inspect"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server-ai-permission"
  });

  const contexts = new ExecutionContextFactory(
    adapterRegistry,
    { resolve: async (actorId) => ({ id: actorId, permissions: ["mapping.view"] }) },
    { resolve: async () => ({ mode: "observe", autoAllowedToolIds: [] }) }
  );

  let providerCalled = false;
  const runner = new AgentRunner(
    {
      complete: async () => {
        providerCalled = true;
        return { content: "This should not be called." };
      }
    },
    new InMemoryAgentConversationStore(),
    skills,
    new SkillToolDispatcher(
      skills,
      new ToolExecutor(
        registry,
        new PermissionEngine({ verify: async () => true }),
        new JsonSchemaValidator()
      )
    ),
    contexts
  );

  await assert.rejects(
    runner.run({
      principal: { subject: "guest-01" },
      serverInstanceId: "server-ai-permission",
      sessionId: "no-ai-access",
      userMessage: "Hello."
    }),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "PERMISSION_DENIED"
  );

  assert.equal(providerCalled, false);
});


test("OpenAI Responses provider maps text and function-call output items", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  let capturedSignal: AbortSignal | null | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedSignal = init?.signal;

    return new Response(JSON.stringify({
      id: "resp_test_001",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Saya akan memeriksa mapping." }]
        },
        {
          type: "function_call",
          call_id: "call_scene_001",
          name: "samp_0123456789abcdef01234567",
          arguments: "{\"project_id\":\"hospital\"}"
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key-not-real",
    model: "test-model",
    maxOutputTokens: 512,
    fetcher: fakeFetch
  });
  const controller = new AbortController();

  const result = await provider.complete({
    systemInstructions: "You are SAMP.AI.",
    messages: [{ role: "user", content: "Review the hospital mapping." }],
    tools: [{
      name: "samp_0123456789abcdef01234567",
      description: "Inspect mapping objects.",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "string" } },
        required: ["project_id"],
        additionalProperties: false
      }
    }],
    signal: controller.signal
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(capturedSignal, controller.signal);
  assert.equal(capturedBody?.model, "test-model");
  assert.equal(capturedBody?.max_output_tokens, 512);
  const sentTools = capturedBody?.tools as Array<Record<string, unknown>>;
  assert.equal(sentTools[0]?.type, "function");
  assert.equal(sentTools[0]?.strict, false);
  assert.equal(result.content, "Saya akan memeriksa mapping.");
  assert.deepEqual(result.toolCalls, [{
    id: "call_scene_001",
    name: "samp_0123456789abcdef01234567",
    arguments: { project_id: "hospital" }
  }]);
});

test("OpenAI Responses provider maps prior assistant tool calls and function outputs", async () => {
  let capturedBody: Record<string, unknown> | undefined;

  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "resp_test_002",
      status: "completed",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "Pemeriksaan selesai." }]
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key-not-real",
    model: "test-model",
    fetcher: fakeFetch
  });

  const result = await provider.complete({
    systemInstructions: "You are SAMP.AI.",
    messages: [
      { role: "user", content: "Inspect this project." },
      {
        role: "assistant",
        content: "I will inspect it.",
        toolCalls: [{
          id: "call_match_001",
          name: "samp_aabbccddeeff001122334455",
          arguments: { project_id: "city" }
        }]
      },
      {
        role: "tool",
        toolCallId: "call_match_001",
        name: "samp_aabbccddeeff001122334455",
        content: "{\"ok\":true,\"result\":{}}"
      }
    ],
    tools: [],
    signal: new AbortController().signal
  });

  const input = capturedBody?.input as Array<Record<string, unknown>>;
  const functionCall = input.find((item) => item.type === "function_call");
  const functionOutput = input.find((item) => item.type === "function_call_output");

  assert.equal(functionCall?.call_id, "call_match_001");
  assert.equal(functionCall?.arguments, "{\"project_id\":\"city\"}");
  assert.equal(functionOutput?.call_id, "call_match_001");
  assert.equal(functionOutput?.output, "{\"ok\":true,\"result\":{}}");
  assert.equal(result.content, "Pemeriksaan selesai.");
  assert.equal(result.toolCalls, undefined);
});

test("OpenAI Responses provider rejects malformed function-call arguments", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key-not-real",
    model: "test-model",
    fetcher: async () => new Response(JSON.stringify({
      output: [{
        type: "function_call",
        call_id: "call_invalid",
        name: "samp_invalid",
        arguments: "{not-json"
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });

  await assert.rejects(
    provider.complete({
      systemInstructions: "",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      signal: new AbortController().signal
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PROVIDER_INVALID_TOOL_ARGUMENTS"
  );
});

test("OpenAI Responses provider reports HTTP errors without exposing the API key", async () => {
  const apiKey = "test-secret-do-not-leak";
  const provider = new OpenAIResponsesProvider({
    apiKey,
    model: "test-model",
    fetcher: async () => new Response(JSON.stringify({
      error: { message: "Invalid API key" }
    }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })
  });

  await assert.rejects(
    provider.complete({
      systemInstructions: "",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      signal: new AbortController().signal
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("HTTP 401") &&
      !error.message.includes(apiKey)
  );
});

test("OpenAI Responses provider validates configuration", () => {
  assert.throws(
    () => new OpenAIResponsesProvider({
      apiKey: " ",
      model: "test-model"
    }),
    /API key is required/
  );

  assert.throws(
    () => new OpenAIResponsesProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "file:///etc/passwd"
    }),
    /HTTPS/
  );
});


test("HTTP adapter gateway authenticates and registers an adapter handshake", async () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const authenticator = new InMemoryBearerAdapterAuthenticator();
  const token = "adapter-test-token-12345678901234567890";
  authenticator.addCredential(token, {
    adapterId: "sampai-pawn",
    serverInstanceId: "gateway-server"
  });

  const gateway = new HttpAdapterGateway(registry, authenticator);
  const address = await gateway.listen(0, "127.0.0.1");
  const baseUrl = "http://" + address.host + ":" + address.port;

  try {
    const health = await fetch(baseUrl + "/health");
    assert.equal(health.status, 200);

    const hello = await fetch(baseUrl + "/v1/adapters/hello", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        protocol: "sampai/0.1",
        message_id: "gateway_hello_001",
        type: "event",
        server_instance_id: "gateway-server",
        timestamp: "2026-11-24T15:00:00Z",
        event: "adapter.hello",
        payload: {
          adapter: {
            name: "sampai-pawn",
            version: "0.1.0",
            runtime: "open.mp"
          },
          capabilities: ["mapping.inspect"],
          limits: {
            max_operations_per_batch: 20,
            max_objects_per_project: 1000
          }
        }
      })
    });

    assert.equal(hello.status, 201);
    assert.ok(registry.getServerCapabilities("gateway-server").includes("mapping.inspect"));

    const heartbeat = await fetch(baseUrl + "/v1/adapters/heartbeat", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token }
    });
    assert.equal(heartbeat.status, 200);

    const current = await fetch(baseUrl + "/v1/adapters/me", {
      headers: { "Authorization": "Bearer " + token }
    });
    assert.equal(current.status, 200);
  } finally {
    await gateway.close();
  }
});

test("HTTP adapter gateway rejects missing and invalid bearer credentials", async () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const authenticator = new InMemoryBearerAdapterAuthenticator();
  authenticator.addCredential("adapter-test-token-12345678901234567890", {
    adapterId: "sampai-pawn",
    serverInstanceId: "gateway-server"
  });

  const gateway = new HttpAdapterGateway(registry, authenticator);
  const address = await gateway.listen(0, "127.0.0.1");
  const baseUrl = "http://" + address.host + ":" + address.port;

  try {
    const missing = await fetch(baseUrl + "/v1/adapters/heartbeat", {
      method: "POST"
    });
    assert.equal(missing.status, 401);

    const invalid = await fetch(baseUrl + "/v1/adapters/heartbeat", {
      method: "POST",
      headers: { "Authorization": "Bearer invalid-token-00000000000000000000" }
    });
    assert.equal(invalid.status, 401);
  } finally {
    await gateway.close();
  }
});

test("HTTP adapter gateway rejects oversized and malformed handshake bodies", async () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const authenticator = new InMemoryBearerAdapterAuthenticator();
  const token = "adapter-test-token-12345678901234567890";
  authenticator.addCredential(token, {
    adapterId: "sampai-pawn",
    serverInstanceId: "gateway-server"
  });

  const gateway = new HttpAdapterGateway(registry, authenticator, {
    maxBodyBytes: 128
  });
  const address = await gateway.listen(0, "127.0.0.1");
  const baseUrl = "http://" + address.host + ":" + address.port;
  const headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  };

  try {
    const oversized = await fetch(baseUrl + "/v1/adapters/hello", {
      method: "POST",
      headers,
      body: JSON.stringify({ payload: "x".repeat(512) })
    });
    assert.equal(oversized.status, 413);

    const malformed = await fetch(baseUrl + "/v1/adapters/hello", {
      method: "POST",
      headers,
      body: "{bad-json"
    });
    assert.equal(malformed.status, 400);
  } finally {
    await gateway.close();
  }
});

test("bearer authenticator revokes a credential without exposing the token", async () => {
  const authenticator = new InMemoryBearerAdapterAuthenticator();
  const token = "adapter-test-token-12345678901234567890";
  authenticator.addCredential(token, {
    adapterId: "sampai-pawn",
    serverInstanceId: "gateway-server"
  });

  assert.equal(
    (await authenticator.authenticate("Bearer " + token))?.adapterId,
    "sampai-pawn"
  );
  assert.equal(authenticator.revokeCredential(token), true);
  assert.equal(await authenticator.authenticate("Bearer " + token), undefined);
});


test("adapter registry expires stale adapters and prunes expired records", () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator()),
    ["sampai/0.1"],
    1000
  );

  const hello = {
    protocol: "sampai/0.1",
    message_id: "hello_expiry_001",
    type: "event",
    server_instance_id: "expiry-server",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.inspect"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  };

  registry.registerHello(hello, {
    adapterId: "sampai-pawn",
    serverInstanceId: "expiry-server"
  });

  const oldDateNow = Date.now;
  try {
    Date.now = () => oldDateNow() + 2000;
    assert.throws(
      () => registry.getServerCapabilities("expiry-server"),
      /No active authenticated adapter/
    );
    assert.equal(registry.list("expiry-server").length, 0);
    assert.equal(registry.list("expiry-server", true).length, 1);
    assert.equal(registry.pruneStale(), 1);
  } finally {
    Date.now = oldDateNow;
  }

  assert.equal(registry.list("expiry-server", true).length, 0);
});

test("HTTP adapter gateway supports an authenticated disconnect endpoint", async () => {
  const registry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const authenticator = new InMemoryBearerAdapterAuthenticator();
  const token = "adapter-test-token-12345678901234567890";
  authenticator.addCredential(token, {
    adapterId: "sampai-pawn",
    serverInstanceId: "disconnect-server"
  });

  const gateway = new HttpAdapterGateway(registry, authenticator);
  const address = await gateway.listen(0, "127.0.0.1");
  const baseUrl = "http://" + address.host + ":" + address.port;

  try {
    registry.registerHello({
      protocol: "sampai/0.1",
      message_id: "hello_disconnect_001",
      type: "event",
      server_instance_id: "disconnect-server",
      timestamp: "2026-11-24T15:00:00Z",
      event: "adapter.hello",
      payload: {
        adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
        capabilities: ["mapping.inspect"],
        limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
      }
    }, {
      adapterId: "sampai-pawn",
      serverInstanceId: "disconnect-server"
    });

    const disconnected = await fetch(baseUrl + "/v1/adapters/me", {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
    assert.equal(disconnected.status, 200);
    assert.equal(registry.list("disconnect-server").length, 0);
  } finally {
    await gateway.close();
  }
});


test("restricted automation blocks draft tools that are not explicitly allowlisted", async () => {
  const registry = new ToolRegistry();
  registry.register({
    ...createReadTool(),
    id: "project.create-draft",
    implementationId: "project.create-draft",
    effect: "draft",
    risk: "low",
    handler: async () => ({ projectId: "hospital", count: 0 })
  });

  const executor = new ToolExecutor(
    registry,
    new PermissionEngine({ verify: async () => true }),
    new JsonSchemaValidator(),
    { write: async () => undefined }
  );

  await assert.rejects(
    executor.execute(
      "project.create-draft",
      { projectId: "hospital" },
      {
        actor: { id: "mapper-01", permissions: ["project.view"] },
        serverInstanceId: "server-test",
        projectId: "hospital",
        adapterCapabilities: ["project.inspect"],
        autonomy: "restricted_automation",
        autoAllowedToolIds: []
      }
    ),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "AUTONOMY_RESTRICTED"
  );
});

test("OpenAI provider rejects insecure non-loopback HTTP endpoints", () => {
  assert.throws(
    () => new OpenAIResponsesProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "http://api.example.com/v1"
    }),
    /HTTPS/
  );

  assert.doesNotThrow(() => new OpenAIResponsesProvider({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "http://127.0.0.1:8787/v1",
    fetcher: async () => new Response(JSON.stringify({ output: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  }));
});

test("agent runner forwards backend-provided approval receipt and draft hash to the context factory", async () => {
  const registry = new ToolRegistry();
  registerMockAdapterTools(registry);

  const skills = new SkillRegistry(
    { verify: async () => true },
    { verify: async () => true }
  );
  const adapterRegistry = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  adapterRegistry.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_approval_forward",
    type: "event",
    server_instance_id: "server-approval-forward",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.inspect"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "server-approval-forward"
  });

  let capturedOptions: { draftHash?: string; approval?: ApprovalReceipt } | undefined;
  const realFactory = new ExecutionContextFactory(
    adapterRegistry,
    { resolve: async (actorId) => ({ id: actorId, permissions: ["ai.use"] }) },
    { resolve: async () => ({ mode: "observe", autoAllowedToolIds: [] }) }
  );

  const contextFactory = {
    create: async (
      principal: { subject: string },
      serverInstanceId: string,
      projectId?: string,
      options?: { draftHash?: string; approval?: ApprovalReceipt; signal?: AbortSignal }
    ) => {
      capturedOptions = options;
      return realFactory.create(principal, serverInstanceId, projectId, options);
    }
  } as unknown as ExecutionContextFactory;

  const runner = new AgentRunner(
    {
      complete: async () => ({ content: "Approval metadata was passed to the trusted context factory." })
    },
    new InMemoryAgentConversationStore(),
    skills,
    new SkillToolDispatcher(
      skills,
      new ToolExecutor(
        registry,
        new PermissionEngine({ verify: async () => true }),
        new JsonSchemaValidator()
      )
    ),
    contextFactory
  );

  const result = await runner.run({
    principal: { subject: "admin-approval" },
    serverInstanceId: "server-approval-forward",
    sessionId: "approval-forward",
    userMessage: "Continue the approved plan.",
    draftHash: approval.draftHash,
    approval
  });

  assert.equal(result.stoppedBecause, "completed");
  assert.equal(capturedOptions?.draftHash, approval.draftHash);
  assert.equal(capturedOptions?.approval?.approvalId, approval.approvalId);
});


function createTaskQueueHarness(options: ConstructorParameters<typeof AdapterTaskQueue>[3] = {}) {
  const adapters = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );

  adapters.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_task_queue",
    type: "event",
    server_instance_id: "task-server",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.create_object"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "task-server"
  });

  const actions = new AdapterActionRegistry();
  const objectAction: AdapterActionDefinition = {
    id: "mapping.object.create",
    description: "Create one mapped object in the server world.",
    requiredCapabilities: ["mapping.create_object"],
    effect: "mutate",
    risk: "low",
    idempotent: true,
    compensation: "undo",
    payloadSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        model_id: { type: "integer", minimum: 1 },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["model_id", "x", "y", "z"]
    },
    resultSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        object_id: { type: "string", minLength: 1 }
      },
      required: ["object_id"]
    }
  };
  actions.register(objectAction);

  const queue = new AdapterTaskQueue(
    adapters,
    actions,
    new JsonSchemaValidator(),
    options
  );

  return { adapters, actions, queue, objectAction };
}

test("adapter task queue validates actions, enforces idempotency, leases, and results", () => {
  const { queue } = createTaskQueueHarness();
  const input = {
    serverInstanceId: "task-server",
    adapterId: "sampai-pawn",
    actionId: "mapping.object.create",
    payload: { model_id: 19377, x: 10, y: 20, z: 3 },
    idempotencyKey: "hospital-wall-0001"
  };

  const first = queue.enqueue(input);
  const duplicate = queue.enqueue(input);
  assert.equal(first.taskId, duplicate.taskId);
  assert.equal(first.state, "queued");

  assert.throws(
    () => queue.enqueue({
      ...input,
      payload: { model_id: 19377, x: 11, y: 20, z: 3 }
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "IDEMPOTENCY_CONFLICT"
  );

  assert.throws(
    () => queue.enqueue({
      ...input,
      idempotencyKey: "hospital-invalid",
      payload: { model_id: 19377, x: "wrong", y: 20, z: 3 }
    }),
    /Invalid payload/
  );

  const lease = queue.claimNext("task-server", "sampai-pawn");
  assert.ok(lease);
  assert.equal(lease.state, "leased");
  assert.equal(lease.attempts, 1);

  assert.throws(
    () => queue.complete(
      "task-server",
      "sampai-pawn",
      lease.taskId,
      "wrong-lease-token",
      { status: "succeeded", output: { object_id: "obj-01" } }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TASK_LEASE_INVALID"
  );

  const completed = queue.complete(
    "task-server",
    "sampai-pawn",
    lease.taskId,
    lease.leaseToken,
    { status: "succeeded", output: { object_id: "obj-01" } }
  );
  assert.equal(completed.state, "succeeded");

  assert.throws(
    () => queue.complete(
      "task-server",
      "sampai-pawn",
      lease.taskId,
      lease.leaseToken,
      { status: "succeeded", output: { object_id: "obj-02" } }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "TASK_LEASE_INVALID"
  );
});

test("adapter task queue retries only idempotent actions after lease expiry", () => {
  const harness = createTaskQueueHarness({ leaseMs: 1000, defaultTtlMs: 10_000 });
  const task = harness.queue.enqueue({
    serverInstanceId: "task-server",
    adapterId: "sampai-pawn",
    actionId: "mapping.object.create",
    payload: { model_id: 19377, x: 10, y: 20, z: 3 },
    idempotencyKey: "retry-idempotent-01",
    maxAttempts: 2
  });

  const firstLease = harness.queue.claimNext("task-server", "sampai-pawn");
  assert.ok(firstLease);

  const oldDateNow = Date.now;
  try {
    Date.now = () => oldDateNow() + 1500;
    const requeued = harness.queue.getTask(task.taskId, "task-server");
    assert.equal(requeued.state, "queued");
    assert.throws(
      () => harness.queue.complete(
        "task-server",
        "sampai-pawn",
        task.taskId,
        firstLease.leaseToken,
        { status: "succeeded", output: { object_id: "obj-old" } }
      ),
      /lease is missing, expired/
    );
  } finally {
    Date.now = oldDateNow;
  }

  const secondLease = harness.queue.claimNext("task-server", "sampai-pawn");
  assert.ok(secondLease);
  assert.equal(secondLease.attempts, 2);
});

test("adapter task queue does not blindly retry a non-idempotent action", () => {
  const harness = createTaskQueueHarness({ leaseMs: 1000, defaultTtlMs: 10_000 });
  harness.actions.register({
    ...harness.objectAction,
    id: "mapping.native.remove",
    description: "Remove a native GTA building for a player.",
    idempotent: false,
    requiredCapabilities: ["mapping.create_object", "world.default_objects.remove_per_player"]
  });

  // Advertise the second capability using a fresh adapter hello.
  harness.adapters.registerHello({
    protocol: "sampai/0.1",
    message_id: "hello_task_native",
    type: "event",
    server_instance_id: "task-server",
    timestamp: "2026-11-24T15:00:00Z",
    event: "adapter.hello",
    payload: {
      adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
      capabilities: ["mapping.create_object", "world.default_objects.remove_per_player"],
      limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
    }
  }, {
    adapterId: "sampai-pawn",
    serverInstanceId: "task-server"
  });

  const task = harness.queue.enqueue({
    serverInstanceId: "task-server",
    adapterId: "sampai-pawn",
    actionId: "mapping.native.remove",
    payload: { model_id: 19377, x: 10, y: 20, z: 3 },
    idempotencyKey: "native-removal-0001"
  });
  const lease = harness.queue.claimNext("task-server", "sampai-pawn");
  assert.ok(lease);

  const oldDateNow = Date.now;
  try {
    Date.now = () => oldDateNow() + 1500;
    const failed = harness.queue.getTask(task.taskId, "task-server");
    assert.equal(failed.state, "failed");
    assert.equal(failed.result?.error?.code, "TASK_OUTCOME_UNKNOWN");
  } finally {
    Date.now = oldDateNow;
  }

  assert.equal(harness.queue.claimNext("task-server", "sampai-pawn"), undefined);
});

test("HTTP adapter gateway delivers tasks and accepts leased task results", async () => {
  const adapters = new AdapterRegistry(
    new ProtocolValidator(createDefaultSchemaValidator())
  );
  const actions = new AdapterActionRegistry();
  actions.register({
    id: "mapping.object.create",
    description: "Create one mapped object.",
    requiredCapabilities: ["mapping.create_object"],
    effect: "mutate",
    risk: "low",
    idempotent: true,
    compensation: "undo",
    payloadSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        model_id: { type: "integer" },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["model_id", "x", "y", "z"]
    },
    resultSchema: {
      type: "object",
      additionalProperties: false,
      properties: { object_id: { type: "string" } },
      required: ["object_id"]
    }
  });
  const queue = new AdapterTaskQueue(adapters, actions, new JsonSchemaValidator());
  const authenticator = new InMemoryBearerAdapterAuthenticator();
  const token = "adapter-task-token-12345678901234567890";
  authenticator.addCredential(token, {
    adapterId: "sampai-pawn",
    serverInstanceId: "task-http-server"
  });

  const gateway = new HttpAdapterGateway(adapters, authenticator, {}, queue);
  const address = await gateway.listen(0, "127.0.0.1");
  const baseUrl = "http://" + address.host + ":" + address.port;
  const headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  };

  try {
    const hello = await fetch(baseUrl + "/v1/adapters/hello", {
      method: "POST",
      headers,
      body: JSON.stringify({
        protocol: "sampai/0.1",
        message_id: "hello_task_http",
        type: "event",
        server_instance_id: "task-http-server",
        timestamp: "2026-11-24T15:00:00Z",
        event: "adapter.hello",
        payload: {
          adapter: { name: "sampai-pawn", version: "0.1.0", runtime: "open.mp" },
          capabilities: ["mapping.create_object"],
          limits: { max_operations_per_batch: 20, max_objects_per_project: 1000 }
        }
      })
    });
    assert.equal(hello.status, 201);

    const queued = queue.enqueue({
      serverInstanceId: "task-http-server",
      adapterId: "sampai-pawn",
      actionId: "mapping.object.create",
      payload: { model_id: 19377, x: 10, y: 20, z: 3 },
      idempotencyKey: "http-task-00001"
    });

    const next = await fetch(baseUrl + "/v1/adapters/tasks/next", {
      headers: { "Authorization": "Bearer " + token }
    });
    assert.equal(next.status, 200);
    const nextBody = await next.json() as {
      task: { taskId: string; leaseToken: string; state: string };
    };
    assert.equal(nextBody.task.taskId, queued.taskId);
    assert.equal(nextBody.task.state, "leased");

    const renewed = await fetch(
      baseUrl + "/v1/adapters/tasks/" + queued.taskId + "/renew",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ lease_token: nextBody.task.leaseToken })
      }
    );
    assert.equal(renewed.status, 200);
    const renewedBody = await renewed.json() as {
      task: { leaseToken: string };
    };

    const result = await fetch(
      baseUrl + "/v1/adapters/tasks/" + queued.taskId + "/result",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          lease_token: renewedBody.task.leaseToken,
          result: {
            status: "succeeded",
            output: { object_id: "created-object-01" }
          }
        })
      }
    );
    assert.equal(result.status, 200);
    const resultBody = await result.json() as {
      task: { state: string; result: { status: string } };
    };
    assert.equal(resultBody.task.state, "succeeded");
    assert.equal(resultBody.task.result.status, "succeeded");
  } finally {
    await gateway.close();
  }
});
