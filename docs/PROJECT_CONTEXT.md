# Project Context and Durable Handoff

Last reviewed: 2026-11-25

This file is the durable project memory for future development sessions and coding agents. Read it before making architectural changes. Keep it updated whenever behavior, boundaries, tests, or the next implementation step changes.

## Repository

- Canonical repository: https://github.com/yyouki/SAMP.AI
- Default branch: `main`
- Package: `samp-ai`, TypeScript ESM, Node.js 22+
- Product: language-independent AI assistant and extensible tool platform for SA-MP and open.mp server development.
- Current maturity: early core scaffold and reference integration; not production-ready.

## Architecture

The AI core must remain independent of Pawn. It communicates with game runtimes through versioned protocol messages and a typed adapter action registry. Each adapter advertises capabilities at handshake; the task queue rejects actions whose required capabilities are not advertised.

Core building blocks include:

- Protocol validators and JSON Schema validation.
- Adapter registry, typed action contracts, authenticated HTTP gateway, and in-memory task queue.
- Task leases, idempotency keys, schema-validated results, and protection against automatic retry of non-idempotent tasks.
- Provider-neutral agent loop and model-provider interface.
- Tool registry, permission/autonomy gates, approval verification interfaces, and extension/skill lifecycle.
- Deterministic Mock Game Adapter for end-to-end tests without a live game server.

The queue, adapter registry, mock world, and Pawn preview/editor state are currently in memory. There is no durable task database, operation ledger, conversation store, or production audit store yet.

## Current Pawn reference adapter

Source files:

- Pawn filterscript: `adapters/pawn/samp_ai_adapter.pwn`
- Action contracts: `src/adapters/pawn/register-pawn-actions.ts`
- Core editor orchestration: `src/mapping/preview-edit-orchestrator.ts`
- Orchestration tests: `test/mapping-preview-edit-orchestrator.test.ts`
- Contract tests: `test/pawn-adapter.test.ts`
- Integration guide: `docs/PAWN_ADAPTER.md`

The filterscript advertises six capabilities/actions:

1. `context.get_player_state` — reads player position, facing, interior, virtual world, and current connection-session ID.
2. `mapping.create_object` — creates one global `CreateObject`; the native does not isolate an object by interior or virtual world. The reference contract accepts only context IDs 0/0 and reports `scope: "global"`.
3. `mapping.preview_player_object` — creates/replaces one private `CreatePlayerObject` preview per player.
4. `mapping.clear_player_preview` — clears only a matching preview for the matching player connection session.
5. `mapping.begin_player_preview_edit` — starts the native editor for the exact active private preview and returns without waiting for the UI interaction.
6. `mapping.get_player_preview_edit_result` — reads the transient edit state and last accepted position/rotation.

### Preview editor state machine

- Initial preview state is `ready`.
- Starting edit changes it to `editing`. Duplicate begin requests while it is already editing are a no-op and return `started: false`.
- Native `OnPlayerEditObject` final response stores the returned transform and sets `completed`.
- Native cancel response restores the prior accepted transform and sets `cancelled`.
- A result read reports one of `ready`, `editing`, `completed`, `cancelled`, or `not_found`.
- The edit callback is deliberately decoupled from the HTTP task lifecycle. The begin task completes promptly; the core enqueues a separate read task to inspect the eventual result.
- Only a `completed` transform is a candidate for the next draft revision. It is not approval and it does not create a global object.

## Core preview-edit orchestration

`MappingPreviewEditOrchestrator` receives a trusted `ExecutionContext`, an adapter task queue/action registry, a permission engine, a draft revision store, and an approval-request port. It authorizes `mapping.edit`, starts the adapter editor, waits for short-lived tasks, polls edit state using bounded cadence/attempts, and creates a new revision only when status is `completed`. `cancelled`, `not_found`, and `timed_out` return without a revision or approval request.

Applying is a distinct `enqueueApprovedApply` call. It requires `mapping.apply`, a verified approval receipt bound to tool ID `mapping.apply_draft`, the exact revision content hash, server, and project. It also refuses interior/virtual-world values other than 0/0 for the current Pawn global `CreateObject` action. The method only enqueues the action; it does not synchronously apply it.

The provided `InMemoryMappingDraftRevisionStore` is a reference/test implementation. `MappingDraftRevisionStore` and `MappingApprovalRequestPort` are interfaces that a real application must implement with durable storage and a user-facing approval workflow. Request deduplication in the orchestrator is process-local.
- Re-preview, clear, disconnect, or filterscript unload invalidates the transient edit state. Player IDs are not sufficient identity; always pair them with the current `session_id` and logical `preview_id`.

## Non-negotiable safety and correctness invariants

1. Model output is untrusted. Validate every action payload, result, identifier, numeric range, operation count, and adapter capability.
2. Adapter authentication identifies a server-side machine, not the human actor. The application must authorize the admin/reviewer and project scope before queuing editor or mutation actions.
3. Editing a player preview is non-publishing. Never turn an editor callback directly into a global create/update/delete without project validation and the relevant explicit approval.
4. Bind every player-targeted task to the current `player_session_id`; never cache it across reconnects. Check both session ID and logical preview ID before editing, reading, or clearing.
5. A Pawn preview is private to one player and only one preview is tracked per player. It is volatile and is cleaned on disconnect and filterscript unload.
6. `CreateObject` is global. The current Pawn action is not per-interior or per-virtual-world despite accepting only 0/0 requested context values.
7. Non-idempotent mutations must not be blindly retried after an unknown outcome. The current queue is in memory and has no durable deduplication across process restarts.
8. Never claim exact undo for native GTA world-object removal. The mock records a simulated directive only.
9. Never execute arbitrary model-generated Pawn, C++, shell, or database code on a server.

## Important files

- `src/adapters/adapter-action-registry.ts` — typed action definitions and contract registry.
- `src/adapters/adapter-task-queue.ts` — enqueue/claim/lease/complete lifecycle.
- `src/protocol/http-adapter-gateway.ts` — authenticated adapter HTTP routes.
- `src/adapters/pawn/register-pawn-actions.ts` — Pawn-specific allowlisted action schemas and policies.
- `adapters/pawn/samp_ai_adapter.pwn` — reference filterscript and native dispatch.
- `src/adapters/mock/mock-game-adapter.ts` — deterministic runtime simulator.
- `test/` — protocol, core, adapter, provider, and extension tests.
- `docs/ROADMAP.md` — implementation phases and exit conditions.
- `docs/PAWN_ADAPTER.md` — Pawn runtime dependencies and action workflow.
- `docs/ADAPTER_GATEWAY.md` — gateway protocol and authentication boundaries.

## Validation status and limitations

- CI validates TypeScript type-checking, unit tests, and TypeScript build.
- Latest verified editor-orchestration CI: [run #45640155561](https://github.com/yyouki/samp-ai/actions/runs/45640155561), commit `8942d4e34ecb73eb19bf8620ea14f9d43024d567` — type-check succeeded, 65 tests passed / 0 failed, and build succeeded.
- Latest verified CI for the interactive preview-editor implementation: [run #45623852494](https://github.com/yyouki/SAMP.AI/actions/runs/45623852494), commit `bf3064878975e370de89f8ffddb09372268e926a` — type-check succeeded, 57 tests passed / 0 failed, and build succeeded.
- Pawn contract tests validate the TypeScript schemas and task queue behavior; they do not compile Pawn.
- The Pawn filterscript has **not** been compiled against a real SA-MP/open.mp server include set or live-tested with `https_samp` and `pawn-json-parser`. Treat it as a reference implementation only.
- No production authenticator, persistent queue/database, durable operation dedupe, signed approval receipt store, recoverable object index, packaged installer, or complete runnable AI/dashboard host application is complete.
- Preview revision storage and approval-request integration are interfaces; the included revision store is in-memory only. The gateway has no public admin endpoint for enqueuing tasks.
- Verify the latest Actions run and repository head before reporting a test result. Do not reuse an old CI result after changing code.

## Working conventions for future sessions

1. Start by reading this file, `README.md`, `docs/ROADMAP.md`, and the relevant action/runtime guide.
2. Fetch the current `main` head before editing; never assume the branch SHA from an earlier conversation.
3. Keep core behavior language-neutral. Put Pawn native calls in the Pawn adapter and expose them through typed capabilities/actions.
4. Every new action needs payload/result schemas, capability advertisement, authorization notes, failure behavior, tests, and user-facing documentation.
5. Keep runtime callbacks short. Do not hold an HTTP task lease while waiting for a player GUI or other human interaction; expose asynchronous state through separate read/event contracts.
6. Update the roadmap and this handoff document in the same change as meaningful behavior updates.
7. After committing, wait for the current CI run to complete and inspect the actual job summary/log before claiming success.
8. If a native API or version boundary is uncertain, verify the official SA-MP/open.mp documentation and record the compatibility requirement.

## Next recommended work

1. Compile the Pawn reference filterscript against the exact target SA-MP/open.mp compiler, includes, and plugin binaries; then live-test connection lifecycle, preview replacement, edit final/cancel, unload, and uncertain HTTP results.
2. Build a runnable backend host and secure admin interface that wires the AI agent, trusted actor resolver, task queue, editor orchestrator, and approval request/verification ports.
3. Replace in-memory queue, adapter registry, revision store, and operation deduplication with durable transactional storage.
4. Add production credentials, signed approval receipts, persistent audit events, and a recoverable server-object inventory.
5. Continue Mapping MVP with catalog provenance, bounded object batches, undo/restore for server-created objects, and compensation.

