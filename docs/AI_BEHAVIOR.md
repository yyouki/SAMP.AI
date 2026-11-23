# AI Behavior, Collaboration, and Permissions

## 1. Product behavior

SAMP.AI should behave like a capable technical teammate for server development. It should be able to:
- understand the active project and its approved constraints;
- ask focused questions when required information is missing;
- explain design alternatives and trade-offs;
- create structured mapping and TextDraw drafts;
- calculate coordinates and show their source/precision;
- proactively suggest relevant improvements when enabled;
- accept corrections without losing approved project decisions;
- evaluate drafts and explain detected problems.

The assistant should be direct and transparent. It must distinguish verified facts, adapter measurements, user instructions, estimates, and its own proposals.

## 2. Collaboration lifecycle

Use an explicit state machine:

```text
idle
  -> understanding
  -> clarification_required (when needed)
  -> proposal_ready
  -> discussion
  -> draft_ready
  -> validation
  -> preview_ready
  -> awaiting_approval
  -> applying
  -> verifying
  -> completed | partially_completed | failed
```

A user correction returns the task to discussion or draft generation and creates a new revision. Rejection records the reason where provided and does not trigger repeated requests for approval.

The AI should not ask unnecessary questions. It can make low-risk defaults for reversible draft details, but it must disclose assumptions. It should ask before choosing materially important details such as location, scale, style, object purpose, or TextDraw behavior.

## 3. Proactive intelligence

Proactive behavior is opt-in and configurable per server, project, and user.

### Event-driven triggers

Potential triggers include:
- an authorized admin starts an editor session;
- a draft remains incomplete;
- a project revision is applied;
- validation detects a meaningful issue;
- a newly added area lacks a required element based on explicit project requirements;
- a user asks the AI to monitor a specific project milestone.

The event source must be explicitly enabled. Do not ingest general player chat or unrelated player activity by default.

### Scheduled checks

Scheduled checks should be low-frequency, cancellable, rate-limited, and based on cached project state. Do not poll a model every few seconds. Prefer event queues and local deterministic checks; call a model only when semantic reasoning is useful.

### Proactive message policy

- Provide a concise reason for the suggestion.
- State what evidence triggered it.
- Do not claim to have changed anything.
- Provide a dismiss / mute / snooze option.
- Avoid repeating dismissed suggestions unless meaningful new evidence appears.
- Respect quiet hours and online/availability preferences.
- Apply per-user and per-project notification budgets.

Suggested configuration:

```json
{
  "proactive": {
    "enabled": true,
    "require_authorized_user_online": true,
    "quiet_hours": {
      "enabled": true,
      "start": "22:00",
      "end": "08:00",
      "timezone": "Asia/Jakarta"
    },
    "max_suggestions_per_user_per_day": 3,
    "minimum_relevance": 0.8,
    "cooldown_minutes_per_topic": 240,
    "channels": ["dashboard", "in_game"]
  }
}
```

These are example defaults, not mandatory values. In-game announcements should be less frequent than dashboard notifications.

## 4. Permission model

Permissions are checked by the backend / trusted adapter for every operation. A user interface hiding a button is not an authorization boundary.

Suggested permissions:

| Permission | Purpose |
|---|---|
| `ai.use` | Start an AI session |
| `ai.discuss` | Discuss and revise a proposal |
| `ai.suggest` | Receive or request recommendations |
| `project.view` | View project data |
| `project.edit` | Edit project metadata and draft requirements |
| `mapping.view` | Inspect mapping |
| `mapping.create` | Create mapping drafts |
| `mapping.edit` | Edit existing mapping drafts |
| `mapping.approve` | Approve mapping changes |
| `mapping.publish` | Apply approved mapping to the server |
| `mapping.delete` | Delete published mapping |
| `textdraw.view` | Inspect TextDraw |
| `textdraw.create` | Create TextDraw drafts |
| `textdraw.edit` | Edit TextDraw drafts |
| `textdraw.approve` | Approve TextDraw changes |
| `textdraw.publish` | Apply approved TextDraw changes |
| `project.restore` | Restore a previous revision |
| `ai.configure` | Change AI behavior and provider settings |
| `ai.audit.view` | View audit records |

Permissions should be scoped by server, project, and resource where practical. Mapping approval must not imply TextDraw approval, or vice versa.

## 5. Approval policy

Default policy:
- Read / inspect: permission required; no approval.
- Suggest / discuss: permission required; no approval.
- Create draft: create permission required; no publish approval.
- Preview: preview permission required; preview is private by default.
- Apply / publish: relevant approval permission plus explicit approval of the exact draft revision.
- Delete / restore / bulk destructive changes: explicit confirmation and stronger permission.
- Change permissions or provider secrets: never delegated to the model.

Approval records bind to the immutable draft content hash. Any subsequent edit invalidates the previous approval. For high-impact actions, require a second authorized reviewer if the server owner configures that policy.

## 6. AI tool boundary

The model can request allowlisted typed tools, for example:

- `project.get_context`
- `context.get_player_state`
- `context.get_selected_point`
- `anchor.create`
- `marker.create_preview`
- `mapping.inspect`
- `draft.create`
- `draft.validate`
- `draft.preview`
- `approval.request`

The model must not receive arbitrary shell, code execution, filesystem, or unrestricted SQL access. Tool arguments are validated against strict schemas and authorization rules.

## 7. Memory and provenance

Store durable project facts separately from conversation transcripts.

Each memory item should record:
- content and project scope;
- source: user, adapter measurement, approved decision, or AI proposal;
- created/updated timestamp;
- author or system identity where applicable;
- confidence if it is an observation or estimate;
- retention policy.

Never promote an AI suggestion to an approved decision without an explicit approval event. Allow authorized users to correct, export, and delete project memory. Minimize retention of personal/player data.

## 8. Failure and uncertainty behavior

The AI should:
- say when a required adapter capability is unavailable;
- label estimated coordinates and ask for confirmation;
- stop when permission checks fail;
- report partial execution rather than claiming full success;
- provide operation IDs and a recovery path for failures;
- avoid retrying non-idempotent operations without checking their status;
- request a human review when the result cannot be verified.

## 9. User control

Provide controls to:
- pause or resume proactive behavior;
- mute a topic or project;
- configure quiet hours and notification budgets;
- inspect what data the AI can access;
- view and revoke connected adapters;
- export or delete project memory;
- cancel a plan or preview;
- review an audit log of AI actions and approvals.
