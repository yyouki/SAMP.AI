# Roadmap

This roadmap prioritizes a safe, testable end-to-end path before adding more adapters and autonomous behavior.

## Phase 0 — Project foundation
- [x] Create project overview and initial design documents.
- [ ] Choose a license.
- [x] Select TypeScript on Node.js 22+ for the standalone core; keep server adapters language-independent.
- [ ] Agree on protocol naming, versioning, and schema tooling.
- [ ] Set up contribution guidelines, code of conduct, and security reporting.

## Phase 1 — Protocol and test harness
- [ ] Define JSON Schemas for message envelopes, coordinates, capabilities, drafts, operations, approvals, execution results, and extension packages.
- [x] Add initial extension manifest, skill, and tool-binding schemas.
- [x] Add machine-readable schemas for protocol messages, adapter handshake, and coordinates.
- [x] Add TypeScript protocol validator and valid/invalid message tests.
- [x] Add CI workflow for TypeScript type-checking, unit tests, and build.
- [x] Add pinned-toolchain Pawn compilation for SA-MP/open.mp and tag-triggered GitHub Release packaging.
- [x] Add reusable JSON Schema validation for extension schemas.
- [x] Add an adapter registry that binds hello messages to authenticated identities, tracks capabilities, and expires stale registrations.
- [x] Add an initial authenticated HTTP gateway for adapter hello, heartbeat, inspection, and disconnect.
- [x] Add a typed adapter action registry and in-memory task queue with idempotency keys, leases, schema-validated results, and non-idempotent retry protection.
- [x] Build a deterministic mock adapter that simulates player state, anchors, markers, server objects, native-world removal directives, and injected failures.
- [ ] Add contract tests so every adapter must pass the same protocol suite.
- [x] Add initial registry, permission, execution, and declarative extension-loader tests.
- [x] Add mock-adapter task execution tests for mapping CRUD, context, anchors, markers, native directives, replay, and failures.
- [x] Add Pawn action-contract tests for advertised capabilities, payload/result schemas, and non-idempotent mutation policy.

**Exit condition:** a mock server can connect, advertise capabilities, receive a validated draft, and return deterministic execution results.

## Phase 2 — Minimal AI Core
- [x] Define provider-neutral model and tool-call contracts.
- [x] Add a bounded agent loop with a conversation-store interface.
- [x] Add an optional OpenAI Responses API provider adapter with injected fetch for testing.
- [ ] Add another cloud or local model provider to verify provider portability.
- [ ] Implement durable conversation/session storage.
- [x] Add an in-memory tool registry with capability metadata.
- [x] Add permission, autonomy, and approval-verifier gates for tool execution.
- [x] Add a trusted execution-context factory backed by actor/policy resolvers and adapter capabilities.
- [x] Add tool input/output validation, timeouts, and optional audit events.
- [x] Integrate provider-specific Responses API function-call and function-output mapping.
- [ ] Implement signed approval receipts and persistent audit storage.
- [x] Add in-memory skill lifecycle: candidate → maintainer review → server-owner enablement.
- [x] Enforce per-skill tool allowlists through a dedicated dispatcher.
- [x] Add bounded steps/tool calls, time budget, and cancellation propagation to tool handlers.
- [ ] Add provider token/cost usage budgets.

**Exit condition:** AI can discuss a request, ask clarifying questions, produce a structured plan, and cannot apply it without approval.

## Phase 3 — First open.mp adapter (Pawn)
- [x] Add authenticated HTTP task claim, lease renewal, and result submission routes.
- [ ] Implement durable task storage and worker-side task deduplication.
- [x] Add a Pawn reference filterscript for authenticated hello, task polling, heartbeat, result submission, player-state reads, global object creation, session-bound per-player previews, and interactive preview editing (runtime compilation/live validation remains open).
- [ ] Compile and connect the Pawn reference adapter to a real SA-MP/open.mp server with the documented HTTPS/JSON dependencies.
- [x] Report server/runtime metadata and the six implemented Pawn capabilities in the handshake.
- [x] Capture online player position, facing direction, interior, virtual-world context, and connection-session ID in the Pawn reference adapter.
- [x] Capture interior and virtual-world context where available.
- [x] Create and clean up one private per-player preview object, guarded by player connection-session and preview IDs.
- [x] Start the native player-object editor without blocking the task queue; capture completed/cancelled edit state and transforms through a separate read action.
- [ ] Implement production-grade bounded object creation / deletion queues.
- [x] Add a first bounded Pawn global-object create action for interior 0 / virtual world 0.
- [ ] Implement per-player native-world removal directives with session deduplication.
- [ ] Return per-operation and per-player-session results.

**Exit condition:** an admin can mark an anchor, request a small mapping draft, preview it, approve it, and apply it without blocking the server tick. A native-world removal request must clearly disclose its player scope and undo limitations.

## Phase 4 — Mapping MVP
- [ ] Build a curated object catalog with provenance, including a native-map object index where licensing and source data permit.
- [ ] Support anchor-relative layouts, offsets, rotation, spacing, and grid snapping.
- [ ] Support object groups and reusable templates.
- [ ] Validate model IDs, coordinate ranges, transforms, operation counts, and duplicates.
- [x] Add a first per-player preview/ghost-object path supported by the Pawn adapter.
- [x] Let an authorized reviewer move/rotate a private preview using the native object editor; keep the edited transform as a draft until a separate approval step.
- [x] Add core orchestration with bounded edit-result polling, session/preview binding, draft revision creation on completion only, and an explicit approval gate before global apply.
- [ ] Add revisions, undo, and restore for server-created objects.
- [ ] Add explicit native-world removal history and reconnect/proxy compensation workflows; never claim exact native restore without runtime support.

**Exit condition:** a small scene can be created, inspected, revised, approved, applied, and rolled back. Native-world operations expose their actual recovery status.

## Phase 5 — TextDraw MVP
- [ ] Define screen-space UI specification separately from world coordinates.
- [ ] Support global and player TextDraw capabilities exposed by the adapter.
- [ ] Generate HUD/menu layouts.
- [ ] Preview at a selected reference resolution and report scaling risks.
- [ ] Validate element bounds, overlap, counts, and adapter-specific limits.
- [ ] Add revisions and rollback.

**Exit condition:** a TextDraw draft can be previewed privately, approved, applied, and restored.

## Phase 6 — Project memory and proactive assistant
- [ ] Store structured project requirements and approved decisions.
- [ ] Store anchor/object/UI relationships and revision summaries.
- [ ] Add event-driven suggestions.
- [ ] Add quiet hours, notification budgets, mute, and snooze.
- [ ] Add scheduled deterministic checks before using model calls.
- [ ] Add user-facing memory inspection and deletion controls.

**Exit condition:** the AI can resume a project accurately and make useful, non-repetitive suggestions without changing content on its own.

## Phase 7 — Additional adapters
- [ ] C++ adapter.
- [ ] TypeScript / JavaScript adapter.
- [ ] Rust adapter.
- [ ] Community adapter guide and compatibility test suite.

The protocol and conformance tests should lead; additional adapters should not introduce language-specific behavior into the core.

## Phase 8 — Dashboard and ecosystem
- [ ] Web dashboard for projects, conversation, previews, approvals, and audit.
- [ ] Dynamic skill and typed-tool registry that is not limited to mapping/TextDraw.
- [ ] AI-generated declarative skill candidates, mock evaluation runner, package diff, and maintainer review flow.
- [ ] Extension manager and manifest format for community skills, tools, adapters, providers, catalogs, and UI components.
- [ ] Per-extension permission, dependency, compatibility, and data-access review.
- [ ] Provider configuration UI.
- [ ] Template library for mapping and TextDraw.
- [ ] Import/export tools for supported mapping formats.
- [ ] Additional domain skills such as diagnostics, project/code assistance, database planning, gameplay design, testing, and documentation.
- [ ] Public documentation and examples.

## Long-term scope

Mapping and TextDraw are the first end-to-end use cases, not permanent limits on the assistant. The extension system should make it possible to add new domains without rewriting the AI core. See [Extensibility and AI Autonomy](EXTENSIBILITY_AND_AUTONOMY.md) and [Self-Expanding Skills](SELF_EXPANDING_SKILLS.md).

## Non-goals for the first MVP

- Arbitrary Pawn/C++ source generation followed by automatic execution.
- Unrestricted shell, filesystem, or production database access.
- Autonomous publishing or destructive changes without approval.
- Promising exact world surface placement when an adapter cannot measure a surface hit.
- Promising immediate exact undo for native-world removal through an API that does not provide a restore operation.
- Supporting every language before one end-to-end adapter is reliable.

## Definition of done for a feature

A feature is not complete until it has:
1. protocol/schema documentation;
2. authorization and validation rules;
3. adapter capability behavior and graceful fallback;
4. tests, including failure cases;
5. user-facing documentation;
6. clear preview / audit behavior for mutating actions.


## Documentation languages

- [x] Add English and Bahasa Indonesia documentation indexes and language selector.
- [x] Link localized Markdown pages with their counterpart and documentation index.
- [ ] Add further languages when translations are reviewed and maintained.
