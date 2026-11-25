# SAMP.AI

> An open-source, language-independent AI assistant for SA-MP and open.mp server development.

SAMP.AI is intended to help server owners and developers design, inspect, preview, and manage in-game content such as map objects and TextDraw interfaces. It is designed as a collaborative assistant: it can propose ideas proactively, but it must discuss uncertain requirements and obtain the required approval before applying changes.

**Project status: Early core scaffold.** The repository contains TypeScript core primitives, protocol/extension schemas, adapter and skill registries, a declarative extension loader, a bounded provider-neutral agent loop, and an optional OpenAI Responses API provider. An in-memory typed adapter task queue and deterministic Mock Game Adapter are included for end-to-end local simulation. A live open.mp adapter, durable queue/persistent storage, production authentication/approval services, and runtime installer are not implemented yet.

## Project goals

- **Language-independent:** one AI core and a versioned protocol, with adapters for Pawn, C++, TypeScript/JavaScript, Rust, and community languages.
- **Coordinate-aware:** obtain positions and orientation from explicit server/editor context, calculate layouts relative to anchors, and show visual markers for review.
- **Collaborative:** clarify requirements, present a plan and preview, accept revisions, and request approval from an authorized person.
- **Proactive:** suggest useful improvements based on permitted project events and stored project context, with quiet hours and rate limits.
- **Safe and reversible:** validate every operation, apply changes in bounded batches, keep revisions, and support rollback where the runtime supports it. Native GTA world-object removal has special undo limitations.
- **Extensible:** do not hard-code the AI to mapping and TextDraw. Allow new skills, typed tools, adapters, model providers, catalogs, and external integrations to expand its capabilities.

## What the AI should help with

### Mapping
- Create and arrange server objects from natural-language descriptions.
- Inspect and remove selected original GTA: San Andreas world objects where the adapter supports it.
- Work from a captured player position, camera direction, selected point, or saved anchor.
- Calculate positions, rotations, offsets, spacing, and object groups.
- Mark proposed anchors, object positions, native-object candidates, boundaries, and paths in-game.
- Preview a draft before it is applied.
- Inspect, edit, save, version, undo, redo, and restore mapping projects according to the capabilities of each object type.

### TextDraw
- Design global TextDraw and player TextDraw layouts.
- Generate HUDs, menus, dialogs, scoreboards, and other UI components.
- Check alignment, bounds, overlap, readability, and adapter limits.
- Preview privately for reviewers before publishing.

### Project assistance
- Remember approved requirements and project decisions.
- Explain why a coordinate, model, layout, or operation was selected.
- Suggest improvements without silently changing the server.
- Track pending work and provide concise progress summaries.

### Extensible development skills
Mapping and TextDraw are initial skills, not the product boundary. Future skills may cover diagnostics, code and resource assistance, database planning, performance analysis, gameplay systems, NPCs, testing, documentation, and controlled deployment workflows. See [Extensibility and AI Autonomy](docs/EXTENSIBILITY_AND_AUTONOMY.md).

## Model providers

The core exposes a provider-neutral interface. An optional OpenAI Responses API adapter is included as the first provider; other providers can be added independently. The API key must stay on the backend and must never be placed in Pawn scripts, game clients, or public configuration files.

See [Provider setup](docs/PROVIDERS.md).

## Core runtime

The standalone core is initially implemented in TypeScript on Node.js 22 or later. This does not constrain game-mode languages: server integrations remain independent adapters using the versioned protocol.

See [Core Implementation](docs/CORE_IMPLEMENTATION.md) for setup and implementation boundaries. The [Mock Game Adapter](docs/MOCK_GAME_ADAPTER.md) guide explains how to run deterministic mapping and world-context simulations. Continuous integration runs type-checking, tests, and the TypeScript build on Node.js 22.

## High-level architecture

```text
Game server / editor adapter
        <-> versioned protocol (JSON initially)
        <-> SAMP.AI Core
             - agent and conversation
             - project memory
             - planning and evaluation
             - permissions and approvals
             - model-provider interface
             - extensible skill and tool registry
        <-> validated action queue
        <-> game server
```

The AI core must not depend on Pawn. Adapters expose capabilities and translate protocol operations into the host environment. The core must only use capabilities that an adapter advertises.

## Local adapter simulation

The Mock Game Adapter processes the same typed task queue used by real adapters. It simulates player state, anchors, review markers, server-created mapping objects, and per-player native-world removal directives. It is intended for deterministic tests and local development only; it does not connect to a running SA-MP/open.mp server. Native-world removal is recorded as a simulated directive and is never represented as a real removal.

See [Mock Game Adapter](docs/MOCK_GAME_ADAPTER.md).

## Coordinate accuracy

The AI must not invent precise coordinates from a text prompt alone. It should use available evidence in this order:

1. A point explicitly selected or marked by the authorized user.
2. A trusted editor-provided surface hit / raycast result, if the adapter supports it.
3. A player position and facing/camera direction, clearly treated as an estimate.
4. Coordinates explicitly supplied by the user.
5. A proposed location that is labelled as an estimate and requires confirmation.

Every coordinate should carry its reference frame, interior/virtual-world context when relevant, source, and confidence. The AI should explain whether a point is exact, adapter-measured, or estimated.

See [Coordinate and Marker Workflow](docs/COORDINATES_AND_MARKERS.md).

## Native GTA world objects

SAMP.AI is planned to support removing original GTA map objects through adapter capabilities such as open.mp / SA-MP `RemoveBuildingForPlayer`. This operation is per player and matches a model ID within a radius; it is not the same as deleting a server-created object.

**Native-world removal cannot be promised an immediate, exact undo.** The documented API has no corresponding native restore function. Depending on the adapter and saved object data, recovery may require reconnecting without reapplying the removal directive or showing an explicitly labelled replacement object. See [Native World Objects and Undo/Redo](docs/NATIVE_WORLD_OBJECTS.md).

## Safety model

The AI may discuss, inspect, plan, and prepare drafts according to the user's permissions. Applying, deleting, publishing, or restoring content requires the relevant permission and approval policy. Model output is untrusted input: validate schemas, IDs, numeric ranges, object counts, and adapter capabilities before execution. Never execute model-generated Pawn/C++/shell code directly.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Universal protocol](docs/PROTOCOL.md)
- [Core implementation](docs/CORE_IMPLEMENTATION.md)
- [HTTP adapter gateway](docs/ADAPTER_GATEWAY.md)
- [AI behavior and permissions](docs/AI_BEHAVIOR.md)
- [Coordinate and marker workflow](docs/COORDINATES_AND_MARKERS.md)
- [Native GTA world objects and undo/redo](docs/NATIVE_WORLD_OBJECTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Extensibility and AI autonomy](docs/EXTENSIBILITY_AND_AUTONOMY.md)
- [Self-expanding skills](docs/SELF_EXPANDING_SKILLS.md)

## Contributing

The protocol and adapter contracts should be agreed before multiple runtime adapters are implemented. Contributions should include tests and documentation. Do not commit API keys, private server data, player personal data, or proprietary assets without permission.

## License

License has not been selected yet. The project owner should choose a license before accepting external contributions or distributing releases.
