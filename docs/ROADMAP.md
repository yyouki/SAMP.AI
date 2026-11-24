# Roadmap

This roadmap prioritizes a safe, testable end-to-end path before adding more adapters and autonomous behavior.

## Phase 0 — Project foundation
- [x] Create project overview and initial design documents.
- [ ] Choose a license.
- [ ] Decide initial implementation language/runtime for the standalone core.
- [ ] Agree on protocol naming, versioning, and schema tooling.
- [ ] Set up contribution guidelines, code of conduct, and security reporting.

## Phase 1 — Protocol and test harness
- [ ] Define JSON Schemas for message envelopes, coordinates, capabilities, drafts, operations, approvals, execution results, and extension packages.
- [x] Add initial extension manifest, skill, and tool-binding schemas.
- [ ] Implement protocol validation.
- [ ] Build a mock adapter that can simulate player state, anchors, markers, server objects, native-world removal directives, and failures.
- [ ] Add contract tests so every adapter must pass the same protocol suite.

**Exit condition:** a mock server can connect, advertise capabilities, receive a validated draft, and return deterministic execution results.

## Phase 2 — Minimal AI Core
- [ ] Implement provider interface and one provider.
- [ ] Implement conversation/session management.
- [ ] Implement structured tool calling with an allowlist.
- [ ] Implement permission and approval checks.
- [ ] Add logging, timeouts, cancellation, and usage budgets.

**Exit condition:** AI can discuss a request, ask clarifying questions, produce a structured plan, and cannot apply it without approval.

## Phase 3 — First open.mp adapter (Pawn)
- [ ] Connect adapter to the core.
- [ ] Report server/runtime metadata and capabilities.
- [ ] Capture player position and facing direction where available.
- [ ] Capture interior and virtual-world context where available.
- [ ] Create and clean up private preview markers.
- [ ] Implement bounded object creation / deletion queues.
- [ ] Implement per-player native-world removal directives with session deduplication.
- [ ] Return per-operation and per-player-session results.

**Exit condition:** an admin can mark an anchor, request a small mapping draft, preview it, approve it, and apply it without blocking the server tick. A native-world removal request must clearly disclose its player scope and undo limitations.

## Phase 4 — Mapping MVP
- [ ] Build a curated object catalog with provenance, including a native-map object index where licensing and source data permit.
- [ ] Support anchor-relative layouts, offsets, rotation, spacing, and grid snapping.
- [ ] Support object groups and reusable templates.
- [ ] Validate model IDs, coordinate ranges, transforms, operation counts, and duplicates.
- [ ] Add preview markers / ghost objects supported by the adapter.
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
