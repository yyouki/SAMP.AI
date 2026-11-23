# SAMP.AI

> An open-source, language-independent AI assistant for SA-MP and open.mp server development.

SAMP.AI is intended to help server owners and developers design, inspect, preview, and manage in-game content such as map objects and TextDraw interfaces. It is designed as a collaborative assistant: it can propose ideas proactively, but it must discuss uncertain requirements and obtain the required approval before applying changes.

**Project status: Planning / specification stage.** The repository is being established. Features described here are goals, not claims of implemented functionality.

## Project goals

- **Language-independent:** one AI core and a versioned protocol, with adapters for Pawn, C++, TypeScript/JavaScript, Rust, and community languages.
- **Coordinate-aware:** obtain positions and orientation from explicit server/editor context, calculate layouts relative to anchors, and show visual markers for review.
- **Collaborative:** clarify requirements, present a plan and preview, accept revisions, and request approval from an authorized person.
- **Proactive:** suggest useful improvements based on permitted project events and stored project context, with quiet hours and rate limits.
- **Safe and reversible:** validate every operation, apply changes in bounded batches, keep revisions, and support rollback.
- **Extensible:** allow community adapters, tools, model providers, object catalogs, and design templates.

## What the AI should help with

### Mapping
- Create and arrange objects from natural-language descriptions.
- Work from a captured player position, camera direction, selected point, or saved anchor.
- Calculate positions, rotations, offsets, spacing, and object groups.
- Mark proposed anchors, object positions, boundaries, and paths in-game.
- Preview a draft before it is applied.
- Inspect, edit, save, version, and restore mapping projects.

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
             - mapping and TextDraw skills
        <-> validated action queue
        <-> game server
```

The AI core must not depend on Pawn. Adapters expose capabilities and translate protocol operations into the host environment. The core must only use capabilities that an adapter advertises.

## Coordinate accuracy

The AI must not invent precise coordinates from a text prompt alone. It should use available evidence in this order:

1. A point explicitly selected or marked by the authorized user.
2. A trusted editor-provided surface hit / raycast result, if the adapter supports it.
3. A player position and facing/camera direction, clearly treated as an estimate.
4. Coordinates explicitly supplied by the user.
5. A proposed location that is labelled as an estimate and requires confirmation.

Every coordinate should carry its reference frame, interior/virtual-world context when relevant, source, and confidence. The AI should explain whether a point is exact, adapter-measured, or estimated.

See [Coordinate and Marker Workflow](docs/COORDINATES_AND_MARKERS.md).

## Safety model

The AI may discuss, inspect, plan, and prepare drafts according to the user's permissions. Applying, deleting, publishing, or restoring content requires the relevant permission and approval policy. Model output is untrusted input: validate schemas, IDs, numeric ranges, object counts, and adapter capabilities before execution. Never execute model-generated Pawn/C++/shell code directly.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Universal protocol](docs/PROTOCOL.md)
- [AI behavior and permissions](docs/AI_BEHAVIOR.md)
- [Coordinate and marker workflow](docs/COORDINATES_AND_MARKERS.md)
- [Roadmap](docs/ROADMAP.md)

## Contributing

The protocol and adapter contracts should be agreed before multiple runtime adapters are implemented. Contributions should include tests and documentation. Do not commit API keys, private server data, player personal data, or proprietary assets without permission.

## License

License has not been selected yet. The project owner should choose a license before accepting external contributions or distributing releases.
