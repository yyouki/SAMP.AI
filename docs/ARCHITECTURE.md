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

### Skills
Examples:
- Mapping planner
- TextDraw designer
- Coordinate resolver
- Scene inspector
- Layout evaluator
- Project assistant

Skills should call typed tools rather than generate code for direct execution.

### Permission and approval engine
Evaluates the actor, permission, resource, project, and action. It also enforces approval rules and records who approved what revision.

### Protocol gateway
Validates messages against versioned schemas, authenticates adapters, applies request limits, and handles reconnects and idempotency.

### Adapter
Runs beside or inside the server integration. It advertises supported operations and limits, reads server/editor state, queues mutations safely, and returns execution results.

### Dashboard / in-game UI
Provides chat, project browser, coordinate tools, previews, review queues, and audit history. An in-game command interface may be a small adapter-facing UI, not the only user interface.

## 3. Suggested deployment

For the first release, use a simple deployment:

- One standalone AI service.
- One adapter per server integration.
- JSON over HTTP for request/response operations.
- WebSocket or server-sent events later for live conversation and event streaming.
- SQLite for local development; PostgreSQL when multi-user and multi-server operation is needed.

Do not start with microservices. Keep modules inside a modular monolith until scaling evidence justifies splitting them.

## 4. Request and execution lifecycle

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

## 5. Coordinate and world context

Coordinates are not plain numbers without context. A position should include:
- coordinate frame: world or local-to-anchor;
- x, y, z and optional rotation;
- interior and virtual-world identifiers when exposed by the adapter;
- source: user-selected, editor raycast, player position, derived, or manually supplied;
- confidence / precision classification;
- timestamp and adapter identity.

The coordinate resolver should use evidence exposed by the adapter. It must not claim an exact surface hit if the adapter only provides player position and facing direction. See [Coordinate and Marker Workflow](COORDINATES_AND_MARKERS.md).

## 6. Capability negotiation

At connection time, an adapter reports:
- protocol versions supported;
- server runtime and version;
- available object creation / update / deletion operations;
- TextDraw capabilities and limits;
- coordinate capture methods;
- marker and preview methods;
- batch limits and rate limits;
- context available (player state, camera direction, interior, virtual world, object inspection).

The AI must degrade gracefully. If an exact raycast is unavailable, it should request a selected point or label its calculated point as an estimate.

## 7. Reliability

- Use a unique request ID and idempotency key for every mutation request.
- Use operation IDs for each object / UI element.
- Make bulk operations transactional where possible; otherwise record partial success and compensating actions.
- Apply object creation in bounded batches to avoid server tick spikes.
- Treat reconnects as normal; adapters should report current state and pending operation status.
- Keep an audit log of draft, approval, execution, failure, undo, and restore events.

## 8. Security boundaries

- Never expose model-provider credentials to game clients.
- Authenticate each adapter and scope it to its server instance.
- Do not provide arbitrary shell, SQL, filesystem, or code-execution tools to the model.
- Validate permissions on the server/backend side, not only in an in-game UI.
- Use allowlisted typed operations and resource limits.
- Keep secrets, player identifiers, and private server data out of prompts unless explicitly required and authorized.
