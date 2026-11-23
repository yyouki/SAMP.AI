# Coordinate and Marker Workflow

This document defines how SAMP.AI should understand positions, calculate layouts, and mark proposed locations in an SA-MP/open.mp environment.

## 1. Goal

A user should be able to say:

- "Build a small police station here."
- "Put the entrance 4 meters in front of this point."
- "Place five lamps evenly along this road."
- "Move the whole building 3 meters east."
- "Mark the corners of this construction area."

The AI should resolve the request into a coordinate-aware draft, show where the proposed items will go, explain uncertainty, and ask for review before applying it.

## 2. Never treat a guessed point as exact

The AI must distinguish the following sources:

| Source | Meaning | Suggested confidence |
|---|---|---|
| User-selected point | User explicitly selected a point using an editor tool | High |
| Trusted surface hit | Adapter/editor performed a real surface query or raycast | High |
| Explicit coordinates | User supplied numeric coordinates | High for numeric value; semantic placement may still need review |
| Player position | Position measured by the server for the player | High for player position, not necessarily for intended build point |
| Camera projection | Point projected from camera direction and a chosen distance | Estimated |
| Derived from anchor | Calculated from a known anchor and offsets | Depends on anchor and transform |
| AI proposal | Suggested from map/catalog/context without a trusted point | Estimated; must be labelled |

A standard server adapter may expose player position and facing direction but may not expose a reliable collision raycast against arbitrary world geometry. Do not claim exact ground placement unless the adapter or editor genuinely provides that capability.

## 3. Ways to capture a location

Adapters may implement one or more capture methods.

### A. Mark current position

An authorized user stands at a location and invokes a command or editor action such as:

```text
/ai mark hospital_origin
```

The adapter captures the user's measured position and relevant world context. This is useful for anchors but is not necessarily the exact ground point in front of the player.

### B. Select a point in an editor

A dashboard or supported in-game editor lets the user select a point. If the editor returns a trusted surface hit, it can provide a higher-confidence placement coordinate.

### C. Camera direction estimate

If the adapter exposes camera position and direction, the AI can project a point at a requested distance. The result must be displayed as an estimate unless a real surface query confirms it.

Example user request:

```text
Place the entrance about 8 meters in front of me.
```

The AI should state which position and direction it used and ask the user to confirm the marker.

### D. Enter coordinates

Users can supply exact numeric values:

```text
/ai anchor set hospital_origin 1172.5 -1325.2 15.4 90.0
```

The exact command syntax belongs to each adapter/UI. The protocol should remain language-neutral.

### E. Select an existing object

Where supported, the user can select a placed object and use it as an anchor. The adapter should return its model ID, transform, interior/virtual-world context, and object ownership/source where available.

## 4. Anchor model

An anchor is a named reference point for a project or group of objects.

Example:

```json
{
  "anchor_id": "hospital_origin",
  "name": "Hospital main entrance origin",
  "coordinate": {
    "frame": "world",
    "position": { "x": 1172.5, "y": -1325.2, "z": 15.4 },
    "rotation": { "x": 0.0, "y": 0.0, "z": 90.0 },
    "context": {
      "interior_id": 0,
      "virtual_world_id": 0
    },
    "provenance": {
      "source": "user_selected_point",
      "confidence": "high"
    }
  },
  "created_by": "admin_42"
}
```

Anchors should support:
- create, rename, move, lock, archive, and delete;
- project-level and session-level scope;
- optional notes and tags;
- visual marker display;
- usage references so the user can see which objects depend on an anchor.

Changing an anchor should not silently move an already approved build. The system should show the affected objects and require a new draft/review.

## 5. Coordinate calculations

The coordinate resolver should support:

- relative offsets from anchors;
- heading-aware forward/right/up offsets;
- distance and midpoint calculations;
- evenly spaced points along a line;
- rectangular and circular layouts;
- rotation and object-group transforms;
- local-to-world and world-to-local transforms;
- grid snapping, angle snapping, and configurable precision.

For example, "place 4 lights evenly over 20 meters" should generate a documented spacing calculation. The AI should clarify whether the 20 meters includes both endpoints.

Do not assume that world X/Y directions correspond to a user's idea of left/right. Convert relative directions using the anchor heading and state the convention used.

## 6. Object-aware placement

Coordinate math alone does not guarantee good mapping. The AI should use a trusted object catalog containing, where available:

- model ID and display name;
- category and tags;
- dimensions / bounding box;
- origin or pivot convention if known;
- preview image;
- known placement notes;
- source and license/provenance.

The AI can then reason about object extents, spacing, approximate overlap, and alignment. If object dimensions are unknown, flag the result for visual review rather than pretending collision analysis is exact.

The first version may start with a small curated catalog. Catalog ingestion and community contributions can be added later.

## 7. In-game markers

"Mark it" should be a first-class workflow, not just a chat response.

The marker system should support abstract marker types such as:

| Marker | Purpose |
|---|---|
| Anchor marker | Shows a named project reference point |
| Proposed object marker | Shows the proposed object origin |
| Boundary marker | Shows build-area corners or perimeter |
| Path marker | Shows a road, wall, or object sequence |
| Measurement marker | Shows distance or spacing |
| Warning marker | Highlights uncertain, invalid, or conflicting placement |

An adapter maps these abstract types to available runtime features, for example a 3D text label, map icon, checkpoint, temporary object, or a dashboard overlay. Not every adapter will support every marker type.

Markers should be:
- visible only to the requesting editor/reviewer by default;
- tagged with project ID and draft/revision ID;
- removable as a group;
- distinguishable from live server content;
- automatically cleaned up when a preview session expires;
- non-interactive unless the adapter explicitly supports safe selection.

The AI should be able to say: "I marked the origin and four corners. The northeast corner is estimated; please confirm it."

## 8. Preview workflow

Recommended sequence:

1. User selects or describes an anchor.
2. Adapter returns available context and capture precision.
3. AI asks for missing dimensions, direction, or layout constraints.
4. AI calculates the layout and records its assumptions.
5. Validator checks finite values, world bounds, IDs, transforms, and capability limits.
6. Adapter creates private preview markers or ghost objects.
7. Authorized user moves, accepts, or rejects the proposed markers.
8. AI updates the draft and produces a new revision.
9. Approval is tied to the final revision hash.
10. Adapter applies the approved operations in bounded batches.

A preview must never be confused with published/live content.

## 9. Useful user-facing tools

The following are conceptual commands; each adapter may expose a different UI:

```text
/ai mark <name>                  Capture current position as an anchor
/ai mark-point <name>            Select a point using supported editor input
/ai anchors                      List project anchors
/ai show-markers                  Show this session's markers
/ai clear-markers                 Remove this session's markers
/ai place <description>           Start a placement discussion
/ai move <target> <offset>        Propose a relative move
/ai rotate <target> <rotation>    Propose a rotation
/ai measure <point-a> <point-b>   Calculate distance
/ai grid <size>                   Set preview snap grid
/ai preview                       Show current draft
```

Every command must still be permission-checked. A user who can create a temporary marker does not automatically have permission to publish mapping.

## 10. TextDraw uses a different coordinate space

TextDraw layout coordinates are screen-space, not world-space. The TextDraw designer should therefore use a separate coordinate model:

- screen width/height or normalized viewport coordinates;
- alignment and anchoring;
- safe margins;
- scaling policy;
- element bounds;
- overlap and z-order;
- player/global scope;
- adapter-specific limits.

Do not reuse 3D world coordinate types for TextDraw positions. A dashboard preview should model the target resolution/aspect ratio and warn when the layout may not fit other clients.

## 11. Required tests

Coordinate and marker implementations should test:

- world/local transform round trips;
- heading-aware forward/right offsets;
- negative and non-finite values;
- precision and rounding;
- interior / virtual-world propagation;
- marker cleanup on disconnect, timeout, and cancellation;
- private marker visibility;
- anchor changes after a draft is approved;
- unsupported capture method fallback;
- adapters that provide player position but no surface hit;
- multiple simultaneous editor sessions.
