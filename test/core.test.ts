import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthorizationError,
  JsonSchemaValidator,
  PermissionEngine,
  ToolExecutor,
  ToolRegistry,
  type ApprovalReceipt,
  type ToolDefinition
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
