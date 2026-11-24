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
| `src/core/tool-registry.ts` | Tool and implementation registry |
| `src/security/permission-engine.ts` | Permission, capability, autonomy, and approval gates |
| `src/core/tool-executor.ts` | Validates and runs registered tools with timeout and audit hooks |
| `src/extensions/extension-loader.ts` | Validates and loads declarative extension candidates |
| `src/adapters/mock/register-mock-tools.ts` | Deterministic mock mapping inspection tool |
| `test/core.test.ts` | Initial core unit tests |

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

## Important boundaries

- The registry is in-memory; persistent tool/extension storage is not implemented.
- The loader validates candidates but does not install or activate them.
- The permission engine requires a trusted `ApprovalVerifier`; this repository does not yet contain a production signature/identity service.
- The `ExecutionContext` must be created by trusted backend authentication and policy code. Never construct it from model output or an untrusted game-client request.
- Tool handlers must honor their `AbortSignal`. A timeout stops awaiting the result but cannot forcibly stop JavaScript code that ignores cancellation.
- The audit interface is injectable. Production deployments need a durable append-only audit implementation.
- The model provider, conversation manager, HTTP/WebSocket protocol server, real Pawn adapter, and dashboard are not implemented in this phase.

This is an implementation scaffold, not a production-ready server integration.
