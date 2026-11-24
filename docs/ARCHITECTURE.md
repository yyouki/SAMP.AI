# Architecture

This document describes the intended architecture. It is a design target, not an implementation claim.

## 1. Design constraints

1. The AI core must not depend on Pawn or on a specific server scripting language.
2. A game-server adapter is responsible for exposing trusted server/editor context and executing validated operations.
3. The core must negotiate adapter capabilities before planning or execution.
4. Model output is untrusted. The validator, permission engine, and approval workflow sit between planning and execution.
5. Potentially expensive model calls and planning run outside the game server's main tick. Server-side mutations are queued and processed in bounded batches.
6. Every mutating operation should be traceable and reversible where the host environment allows it.

## 2. Components

### AI Core
Owns orchestration, conversations, project sessions, task state, and routing to skills and providers.

### Agent runtime
Runs bounded agent cycles: observe permitted events, decide whether a suggestion is relevant, prepare a proposal, and wait for input or approval. It must not run an uncontrolled infinite loop.

### Model provider interface
Abstracts cloud and local model providers. The provider interface should support structured output / tool calling where available, timeouts, cancellation, usage accounting, and safe secret handling.

### Project memory
Stores structured project data: anchors, scene objects, TextDraw elements, requirements, approved decisions, revisions, and relevant conversation summaries. Memory must distinguish facts supplied by a user, measurements supplied by an adapter, estimates, and AI proposals.

### Skills and dynamic tool registry
Skills are modular domain workflows, not a fixed list of product features. Initial examples include mapping planner, TextDraw designer, coordinate resolver, scene inspector, layout evaluator, and project assistant. Future contributors may add diagnostics, code/resource assistance, database planning, gameplay design, NPC tooling, testing, documentation, and other workflows.

A dynamic registry exposes only installed and enabled skills/tools that match the current adapter capabilities. Every tool declares its schema, permissions, data access, risk, resource limits, and undo/compensation behavior. Skills should call typed tools rather than generate code for direct execution. See [Extensibility and AI Autonomy](EXTENSIBILITY_AND_AUTONOMY.md).

### Permission and approval engine
Evaluates the actor, permission, resource, project, and action. It also enforces approval rules and records who approved what revision.

### Protocol gateway
Validates messages against versioned schemas, authenticates adapters, applies request limits, and handles reconnects and idempotency.

### Adapter
Runs beside or inside the server integration. It advertises supported operations and limits, reads server/editor state, queues mutations safely, and returns execution results.

### Extension manager
Installs and manages community skills, tools, adapters, providers, catalogs, and UI extensions. Extensions declare dependencies, compatibility, permissions, and data access. Installation alone must not grant runtime permissions.

The first extension format is declarative: skills compose existing registered tools. AI-generated candidates are validated and tested against mock tools, but remain disabled until maintainer review and server-owner activation. New executable tool implementations require a reviewed core/adapter contribution. See [Self-Expanding Skills](SELF_EXPANDING_SKILLS.md).

### Dashboard / in-game UI
Provides chat, project browser, coordinate tools, previews, review queues, and audit history. An in-game command interface may be a small adapter-facing UI, not the only user interface.

## 3. Initial core implementation decision

The first standalone core runtime uses **TypeScript on Node.js 22+**. This choice is for the service layer, developer tooling, schema validation, and extension workflow—not for gamemode code. Pawn, C++, Rust, TypeScript/JavaScript, and other integrations communicate through adapters and the language-neutral protocol.

The initial source scaffold provides:
- an in-memory tool registry with immutable metadata snapshots;
- JSON Schema validation using Ajv;
- permission, adapter-capability, autonomy, and approval checks;
- a timed tool executor with optional audit events;
- a declarative extension candidate loader with path containment checks;
- a deterministic mock mapping-inspection tool and unit tests.

The extension loader returns a **disabled candidate**. It does not install or activate extensions. The approval verifier is an injected interface; a production cryptographic approval service and persistent identity store are still required.

## 4. Suggested deployment

For the first release, use a simple deployment:

- One standalone AI service.
- One adapter per server integration.
- JSON over HTTP for request/response operations.
- WebSocket or server-sent events later for live conversation and event streaming.
- SQLite for local development; PostgreSQL when multi-user and multi-server operation is needed.

Do not start with microservices. Keep modules inside a modular monolith until scaling evidence justifies splitting them.

## 5. Request and execution lifecycle

```text
User / permitted server event
        |
        v
Identity + permission check
        |
        v
Context collection through adapter tools
        |
        v
Clarification / proposal / plan
        |
        v
Structured draft (scene or UI specification)
        |
        v
Schema + semantic + capability validation
        |
        v
Private preview and authorized approval
        |
        v
Action queue (rate-limited batches)
        |
        v
Adapter execution + result report
        |
        v
Verification + revision history
```

A request to inspect or propose does not imply permission to mutate. Approval must be bound to an immutable draft/revision hash so that a changed draft needs a new approval.

## 6. Coordinate and world context

Coordinates are not plain numbers without context. A position should include:
- coordinate frame: world or local-to-anchor;
- x, y, z and optional rotation;
- interior and virtual-world identifiers when exposed by the adapter;
- source: user-selected, editor raycast, player position, derived, or manually supplied;
- confidence / precision classification;
- timestamp and adapter identity.

The coordinate resolver should use evidence exposed by the adapter. It must not claim an exact surface hit if the adapter only provides player position and facing direction. See [Coordinate and Marker Workflow](COORDINATES_AND_MARKERS.md).

## 7. Capability negotiation

At connection time, an adapter reports:
- protocol versions supported;
- server runtime and version;
- available object creation / update / deletion operations;
- TextDraw capabilities and limits;
- coordinate capture methods;
- marker and preview methods;
- batch limits and rate limits;
- context available (player state, camera direction, interior, virtual world, object inspection).

The AI must degrade gracefully. If an exact raycast is unavailable, it should request a selected point or label its calculated point as an estimate. The same principle applies to every domain: discover capabilities, explain unavailable operations, and never claim access the adapter does not provide.

## 8. Reliability

- Use a unique request ID and idempotency key for every mutation request.
- Use operation IDs for each object / UI element.
- Make bulk operations transactional where possible; otherwise record partial success and compensating actions.
- Apply object creation in bounded batches to avoid server tick spikes.
- Treat reconnects as normal; adapters should report current state and pending operation status.
- Keep an audit log of draft, approval, execution, failure, undo, and restore events.

## 9. Security boundaries

- Never expose model-provider credentials to game clients.
- Authenticate each adapter and scope it to its server instance.
- Do not provide arbitrary shell, SQL, filesystem, or code-execution tools to the model.
- Validate permissions on the server/backend side, not only in an in-game UI.
- Use allowlisted typed operations and resource limits.
- Keep secrets, player identifiers, and private server data out of prompts unless explicitly required and authorized.
