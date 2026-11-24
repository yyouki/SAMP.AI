# Core Implementation

## Runtime decision

The standalone SAMP.AI Core uses **TypeScript on Node.js 22 or later** for the initial implementation. This is a service/runtime decision only. Gamemodes and server integrations remain language-independent and communicate through the protocol.

## Requirements

- Node.js 22+
- npm 10+
- An environment that can install the dependencies listed in package.json

## Setup

From the repository root:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Implemented source scaffold

| Path | Responsibility |
|---|---|
| `src/shared/contracts.ts` | Tool, actor, approval, and audit contracts |
| `src/validation/json-schema-validator.ts` | Ajv-based JSON Schema validation |
| `src/validation/create-default-schema-validator.ts` | Registers extension and protocol schemas |
| `src/protocol/protocol-validator.ts` | Validates message envelopes, adapter handshakes, and coordinates |
| `src/protocol/http-adapter-gateway.ts` | Registration, heartbeat, adapter inspection, and disconnect HTTP routes |
| `src/adapters/bearer-adapter-authenticator.ts` | Development-only hashed bearer credential authenticator |
| `src/adapters/adapter-registry.ts` | Stores authenticated adapter identities, advertised capabilities, and heartbeat expiry |
| `src/core/tool-registry.ts` | Tool and implementation registry |
| `src/security/permission-engine.ts` | Permission, capability, autonomy, and approval gates |
| `src/security/execution-context-factory.ts` | Builds context from trusted principal, permissions, policy, and adapter capabilities |
| `src/core/tool-executor.ts` | Validates and runs registered tools with timeout and audit hooks |
| `src/extensions/extension-loader.ts` | Validates and loads declarative extension candidates |
| `src/extensions/skill-registry.ts` | Tracks candidates, maintainer review, and per-server activation |
| `src/extensions/skill-tool-dispatcher.ts` | Enforces skill tool allowlists before dispatch |
| `src/agent/contracts.ts` | Provider-neutral model and conversation contracts |
| `src/agent/in-memory-conversation-store.ts` | Development conversation history store |
| `src/agent/agent-runner.ts` | Bounded model/tool orchestration loop |
| `src/providers/openai-responses-provider.ts` | Optional OpenAI Responses API provider adapter |
| `src/adapters/mock/register-mock-tools.ts` | Deterministic mock mapping inspection tool |
| `test/core.test.ts` | Initial core unit tests |

## HTTP adapter gateway

The first gateway exposes `GET /health`, `POST /v1/adapters/hello`, `POST /v1/adapters/heartbeat`, `GET /v1/adapters/me`, and `DELETE /v1/adapters/me`. It binds each authenticated bearer credential to one adapter/server identity and applies a request body limit. The default bind address is loopback.

See [HTTP Adapter Gateway](ADAPTER_GATEWAY.md) for the route contract and production deployment warnings.

## Adapter registry

The adapter registry accepts a validated hello only when the server instance and adapter name match identity supplied by trusted transport authentication. It replaces stale capabilities on reconnect and exposes the union of capabilities for a server instance.

The registry does not implement credential authentication itself. A future HTTP/WebSocket gateway must authenticate the adapter first and pass the resulting trusted identity into `registerHello`. `ExecutionContextFactory` similarly resolves user permissions and autonomy from trusted backend services and can attach a server-verified approval receipt.

## Execution context

The execution context factory accepts a principal already authenticated by a future gateway, resolves the actor's server/project permissions and autonomy policy, and obtains capabilities from the adapter registry. It accepts an approval receipt only as an input supplied by trusted backend approval storage; the permission engine still verifies the receipt through the injected approval verifier.

## Protocol validation

The default schema validator includes the versioned protocol schemas. The protocol validator checks messages and coordinates before they cross a trusted adapter boundary.

```ts
import {
  createDefaultSchemaValidator,
  ProtocolValidator
} from "./src/index.js";

const protocol = new ProtocolValidator(createDefaultSchemaValidator());
const adapterHello = protocol.validateAdapterHello(incomingMessage);
console.log(adapterHello.payload.capabilities);
```

## Minimal usage

```ts
import {
  createDefaultSchemaValidator,
  ExtensionLoader,
  registerMockAdapterTools,
  ToolRegistry
} from "./src/index.js";

const tools = new ToolRegistry();
registerMockAdapterTools(tools);

const loader = new ExtensionLoader(
  createDefaultSchemaValidator(),
  tools
);

// This only validates and returns a disabled candidate.
const candidate = await loader.loadCandidate(
  "./examples/extensions/scene-auditor"
);

console.log(candidate.manifest.name);
```

The mock tool is for tests and development. It does not connect to an open.mp server.

## Agent loop

The provider-neutral agent runner exposes only tools attached to skills enabled for the current server and visible to the authenticated actor. Every tool call is routed through the skill dispatcher and the permission-aware executor. The loop has capped steps, capped tool calls, a time budget, and cancellation support.

The included in-memory conversation store is for tests and local development only. The agent loop exposes only tools from enabled skills, caps history/steps/tool calls/time/output, uses provider-compatible tool names, and propagates cancellation to tool handlers. An optional OpenAI Responses API provider is included; other providers remain independent adapters.

## Important boundaries

- The registry is in-memory; persistent tool/extension storage is not implemented.
- The loader validates candidates and computes a SHA-256 hash from the manifest and referenced instruction files, but does not install or activate them. The in-memory skill registry provides an initial review/enable lifecycle with injected verifiers; production persistence and cryptographic review/owner tokens are still required.
- The permission engine requires a trusted `ApprovalVerifier`; this repository does not yet contain a production signature/identity service.
- The `ExecutionContext` must be created by trusted backend authentication and policy code. Never construct it from model output or an untrusted game-client request.
- Tool handlers must honor their `AbortSignal`. A timeout stops awaiting the result but cannot forcibly stop JavaScript code that ignores cancellation.
- A non-read tool (draft, mutate, delete, publish, execute) is blocked unless an audit sink is configured. Production deployments need a durable append-only audit implementation. If the final success event cannot be persisted after a tool ran, the executor returns `AUDIT_PERSISTENCE_FAILED`; callers must check the operation state before retrying.
- The OpenAI provider uses the Responses API. Configure it with a server-side API key and model name; do not expose credentials to game clients.
- Durable conversation storage, generic adapter action/task dispatch, real Pawn adapter, and dashboard are not implemented in this phase. The HTTP gateway currently handles adapter registration, heartbeat, inspection, and disconnect only.

This is an implementation scaffold, not a production-ready server integration.
