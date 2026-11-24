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
  type ApprovalReceipt,
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
  type ModelProvider
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
    dispatcher.execute(
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
  assert.equal(context.draftHash, "sha256:revision-001");
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
    { resolve: async () => ({ id: "different-user", permissions: ["mapping.view"] }) },
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
      resolve: async (actorId) => ({ id: actorId, permissions: ["mapping.view"] })
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
    { resolve: async (actorId) => ({ id: actorId, permissions: ["mapping.view"] }) },
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
  assert.ok(result.response.includes("unavailable") || result.response.includes("cannot"));
});
