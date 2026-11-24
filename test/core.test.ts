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
  ProtocolValidator
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

  return new ToolExecutor(registry, permissionEngine, schemas);
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
  assert.deepEqual(candidate.toolBindings, [{ id: "community.scene-auditor.inspect", implementationId: "mapping.inspect" }]);
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

  try {
    const sourceDirectory = resolve(process.cwd(), "examples/extensions/scene-auditor");
    await cp(sourceDirectory, temporaryDirectory, { recursive: true });

    const manifestPath = join(temporaryDirectory, "extension.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      tools: Array<{ implementation: string }>;
    };
    manifest.tools[0]!.implementation = "database.drop_all";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await assert.rejects(
      loader.loadCandidate(temporaryDirectory),
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

  const result = validator.validateCoordinate<typeof coordinateSample>(coordinate);
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
