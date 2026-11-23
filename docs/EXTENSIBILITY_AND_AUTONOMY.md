# Extensibility and AI Autonomy

## 1. Product philosophy

SAMP.AI should not be artificially limited to mapping and TextDraw. Those are initial, concrete skills for validating the architecture—not the boundary of what the assistant may eventually help with.

The long-term direction is a general-purpose development partner for SA-MP / open.mp server projects. New abilities should be addable through skills, typed tools, adapters, model providers, and external extensions without redesigning the core.

The guiding principle is:

> **Keep capability extensible; keep authority explicit.**

This means:
- Do not hard-code the assistant to a small fixed list of product features.
- Allow the community to add new skills and integrations.
- Let the assistant reason across multiple project domains when the required context and tools exist.
- Do not confuse broad capability with unrestricted access to a server.
- The owner/operator decides which integrations are connected and which actions each identity may perform.

## 2. Beyond mapping and TextDraw

Potential future skill domains include, but are not limited to:

- Mapping, native-world objects, interiors, and object inspection.
- TextDraw, HUD, menus, dialogs, and interface systems.
- Game mode and filterscript assistance.
- Resource/configuration inspection and validation.
- Diagnostics, log analysis, and bug investigation.
- Performance profiling and optimization suggestions.
- Database schema review and migration planning.
- Gameplay systems, jobs, factions, economy, and progression design.
- NPC, dialogue, mission, and world-event authoring.
- Test generation, regression plans, and test execution through a controlled runner.
- Documentation, code explanation, and project onboarding.
- Import/export and conversion between supported mapping or UI formats.
- Build, deployment, and release assistance through explicitly connected integrations.

This list is illustrative, not a fixed product boundary. New domains can be proposed by maintainers and community contributors.

## 3. Skills, tools, adapters, and providers

Keep these concepts separate:

### Skill
A domain workflow describing how the agent reasons about a task. A skill may use multiple tools and may ask questions, prepare drafts, evaluate results, or summarize work.

### Tool
A small typed operation with a schema, capability requirement, permission requirement, input validation, and result contract. Examples include reading a project file, inspecting an object, querying a database schema, or creating a preview marker.

### Adapter
An integration that connects a particular runtime or external system and exposes supported tools. An adapter reports its capabilities and limits; the AI must not assume unavailable operations exist.

### Provider
A model endpoint or local model implementation. Provider choice must not change permission policy or bypass validation.

### Extension
A distributable package containing one or more skills, tools, adapters, model providers, catalogs, or UI components. Extensions should declare their version, dependencies, permissions, data access, network requirements, and compatibility.

## 4. Dynamic capability registry

The core should discover installed capabilities at runtime.

Each tool declaration should describe:
- stable tool identifier and version;
- human-readable purpose;
- input and output schema;
- required adapter capabilities;
- required permissions;
- whether it reads, drafts, mutates, deletes, publishes, or executes;
- risk classification;
- idempotency and undo/compensation support;
- resource limits and timeout;
- data accessed and data transmitted externally.

The model may select tools from the capabilities available to the current session. The tool gateway must independently enforce the declaration and the user's permissions. The model's selection is never authorization.

Extensions must not be able to silently grant themselves permissions or register tools that bypass the gateway.

## 5. Autonomy levels

The server owner should be able to configure autonomy by action category, project, and user.

Suggested levels:

| Level | Behavior |
|---|---|
| Observe | Read permitted context and report findings |
| Suggest | Propose ideas and explain why |
| Draft | Prepare changes without applying them |
| Apply with approval | Apply only after an authorized person approves the exact draft |
| Restricted automation | Automatically perform explicitly allowlisted, low-risk actions under configured limits |

High-impact or destructive actions—such as deleting content, changing production configuration, running migrations, publishing a release, or altering access control—should require explicit approval regardless of general autonomy settings unless the owner has deliberately configured a narrowly scoped, auditable exception.

Autonomy must never let the agent:
- grant itself permissions;
- change its own security policy;
- access tools that the adapter has not exposed;
- bypass approval or validation;
- conceal actions from the audit log;
- expand access to unrelated player or personal data.

## 6. Risk and reversibility

Before execution, classify each operation:

- **Read-only:** inspect or retrieve information.
- **Draft-only:** create a proposal or preview.
- **Reversible mutation:** has a tested inverse or reliable compensation action.
- **Partially reversible:** some effects cannot be perfectly restored.
- **Irreversible / high impact:** requires explicit confirmation and a clear impact summary.

Do not label an operation "undoable" merely because its inputs were stored. Native GTA world-object removal is an example where the underlying API does not provide a true immediate restore operation; see [Native World Objects and Undo/Redo](NATIVE_WORLD_OBJECTS.md).

Undo/redo behavior must be declared per tool and operation type. The UI must explain when recovery requires reconnecting, a proxy replacement, manual repair, or is unavailable.

## 7. Open extension ecosystem

A future extension system should include:

- a documented extension manifest;
- semantic versioning and compatibility metadata;
- permission and data-access declarations;
- signed or trusted publisher metadata where practical;
- dependency and update management;
- sandboxing or process isolation for untrusted extensions;
- explicit admin installation and enablement;
- audit logs for extension actions;
- a review and security-reporting process.

A community extension should not gain access merely because it is installed. The server owner must enable it and grant its declared permissions.

## 8. Design rule

When proposing a new AI capability, ask:

1. What user problem does it solve?
2. Which context does it need?
3. Which typed tools and adapter capabilities are required?
4. What permissions does it need?
5. What can go wrong?
6. Can the action be previewed, audited, cancelled, or undone?
7. How will it be tested against a mock adapter?

If these questions have clear answers, the capability can be considered for the ecosystem without adding a hard-coded limit to the AI's overall scope.
