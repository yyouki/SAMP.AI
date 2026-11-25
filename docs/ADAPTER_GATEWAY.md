# HTTP Adapter Gateway

> **Language:** [English](ADAPTER_GATEWAY.md) | [Bahasa Indonesia](id/ADAPTER_GATEWAY.md) · [Documentation index](INDEX.md) · [Language options](LANGUAGES.md)

## Purpose

The gateway is a machine-to-machine transport for authenticated adapter registration, liveness, and execution of **pre-registered typed tasks**. It is not a public player API and it does not accept arbitrary code or arbitrary action names.

An AI Core service or trusted server-side orchestrator may enqueue a task through the internal `AdapterTaskQueue` API after its own permission and approval checks. Adapters only claim tasks addressed to their authenticated adapter/server identity.

## Endpoints

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/health` | None | Basic health response |
| POST | `/v1/adapters/hello` | Adapter bearer token | Validate and register `adapter.hello` |
| POST | `/v1/adapters/heartbeat` | Adapter bearer token | Refresh adapter liveness |
| GET | `/v1/adapters/me` | Adapter bearer token | Return the authenticated adapter record |
| DELETE | `/v1/adapters/me` | Adapter bearer token | Disconnect and unregister the authenticated adapter |
| GET | `/v1/adapters/tasks/next` | Adapter bearer token | Claim the next leased task for this adapter |
| POST | `/v1/adapters/tasks/{taskId}/renew` | Adapter bearer token + lease token | Renew a valid task lease |
| POST | `/v1/adapters/tasks/{taskId}/result` | Adapter bearer token + lease token | Submit a validated task result |

The authenticated credential is bound server-side to one `adapterId` and one `serverInstanceId`. The gateway does not trust those identities from an arbitrary request body.

## Registration request

`POST /v1/adapters/hello` requires `Content-Type: application/json` and the versioned `adapter.hello` envelope.

```http
POST /v1/adapters/hello HTTP/1.1
Authorization: Bearer <server-adapter-token>
Content-Type: application/json
```

The JSON payload follows [the adapter handshake schema](../schemas/protocol/adapter-hello.schema.json). A successful response returns the registered runtime, protocol, capability snapshot, limits, and timestamps.

## Task lifecycle

The initial task implementation is in-memory:

1. Trusted core code registers an `AdapterActionDefinition` in `AdapterActionRegistry`. It declares a stable action ID, payload/result JSON schemas, required capabilities, risk, effect, idempotency, and compensation.
2. Trusted orchestration code validates user permissions, draft approval, and autonomy before calling `AdapterTaskQueue.enqueue()`.
3. The queue verifies the target adapter is active and advertises every required capability, validates the payload schema, applies a queue limit, and records an idempotency key.
4. The adapter polls `GET /v1/adapters/tasks/next`. A claimed task includes an opaque lease token and expiry.
5. The adapter executes the typed action using its own allowlisted native implementation. It must not interpret task fields as source code or shell commands.
6. The adapter submits a result to `POST /result`. The queue validates the result schema and finalizes the task.
7. If a lease expires, an idempotent action may be requeued up to its attempt limit. A non-idempotent action is marked `TASK_OUTCOME_UNKNOWN` and is never blindly retried.

Example result payload:

```json
{
  "lease_token": "opaque-lease-token",
  "result": {
    "status": "succeeded",
    "output": {
      "object_id": "server-object-42"
    }
  }
}
```

A failed result must include `error.code` and `error.message`. Successful and partially successful results must satisfy the registered result schema.

**Important:** lease expiry cannot prove that an adapter did not perform the side effect. Adapters must implement their own durable deduplication keyed by task ID/idempotency key before production use. For non-idempotent actions, the queue stops automatic retry and asks an operator to inspect server state.

## Idempotency and queue limits

- Idempotency keys are scoped by server instance and adapter.
- Reusing the same key with the same action and payload returns the original task.
- Reusing the same key with a different action or payload returns an idempotency conflict.
- The initial queue has configurable task TTL, lease duration, per-adapter queue limit, and attempt limit.
- Queue and adapter registry storage are in-memory and are lost on process restart.
- A production queue requires durable storage, transactional task leasing, worker deduplication, dead-letter handling, and audit retention.

## Heartbeat and stale adapters

Send `POST /v1/adapters/heartbeat` approximately every 15 seconds. The initial registry default marks an adapter stale after 60 seconds without a successful heartbeat.

Stale adapters are excluded from capability lookup, cannot claim tasks, and must send a new hello to reconnect. The stale interval is configurable. A production service should periodically call `pruneStale()` or otherwise clean up stale entries.

## Local development

The gateway binds to `127.0.0.1` by default and can be started on an ephemeral port for tests.

The in-memory bearer authenticator stores only SHA-256 digests of configured tokens. It is a development implementation; production credentials should come from a secret manager or a persistent credential store, with rotation and revocation audit.

## Production deployment requirements

- Keep the gateway on loopback or a private network by default.
- If adapters connect across machines, terminate TLS at a trusted HTTPS reverse proxy or provide an equivalent TLS transport.
- Never send bearer credentials over public plaintext HTTP.
- Issue a unique, high-entropy token per adapter/server pair.
- Keep tokens out of Pawn source, client files, logs, screenshots, and public repositories.
- Rotate or revoke credentials after compromise.
- Apply network firewall rules and request rate limits at the proxy/service boundary.
- Use durable adapter/task/credential storage and operational monitoring.
- Configure a heartbeat interval shorter than the stale timeout.
- Do not expose this adapter gateway directly to game clients.

## Current limitations

This stage provides adapter registration/liveness plus an in-memory typed task queue. It does not yet provide:
- a compiled and live-tested Pawn adapter; an initial reference filterscript exists for player-state reads, global object creation, and session-bound per-player previews, but it has not been validated against a real SA-MP/open.mp server and plugin combination;
- a durable queue, database-backed leases, or durable idempotency ledger;
- a player/admin authentication endpoint;
- a public/admin endpoint for enqueueing tasks;
- a full action dispatcher for all planned mapping/TextDraw/world operations;
- WebSocket streaming;
- built-in TLS termination;
- rate limiting and credential administration APIs;
- persistent adapter registry or credentials.

These are explicit follow-on features, not hidden behavior.
