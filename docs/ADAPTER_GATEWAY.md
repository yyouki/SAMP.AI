# HTTP Adapter Gateway

## Purpose

The initial HTTP gateway is a small machine-to-machine transport for adapter registration and liveness. It is not a public player API and does not yet dispatch general server actions.

## Endpoints

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/health` | None | Basic health response |
| POST | `/v1/adapters/hello` | Adapter bearer token | Validate and register `adapter.hello` |
| POST | `/v1/adapters/heartbeat` | Adapter bearer token | Refresh adapter liveness |
| GET | `/v1/adapters/me` | Adapter bearer token | Return the authenticated adapter record |
| DELETE | `/v1/adapters/me` | Adapter bearer token | Disconnect and unregister the authenticated adapter |

The authenticated credential is bound server-side to one `adapterId` and one `serverInstanceId`. The gateway does not trust those identities from an arbitrary request body.

## Registration request

`POST /v1/adapters/hello` requires `Content-Type: application/json` and the versioned `adapter.hello` envelope.

```http
POST /v1/adapters/hello HTTP/1.1
Authorization: Bearer <server-adapter-token>
Content-Type: application/json
```

The JSON payload follows [the adapter handshake schema](../schemas/protocol/adapter-hello.schema.json). A successful response returns the registered runtime, protocol, capability snapshot, limits, and timestamps.

## Heartbeat and stale adapters

Send `POST /v1/adapters/heartbeat` approximately every 15 seconds. The initial registry default marks an adapter stale after 60 seconds without a successful heartbeat.

Stale adapters:
- are excluded from `getServerCapabilities()`;
- cannot be returned as active by `getAdapter()`;
- cannot refresh using heartbeat alone after expiry; they must send a new hello;
- can be removed with `pruneStale()`.

The stale interval is configurable when constructing the adapter registry. A production service should periodically call `pruneStale()` or otherwise clean up stale entries.

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
- Use durable adapter/credential storage and operational monitoring.
- Configure a heartbeat interval shorter than the stale timeout.
- Do not expose this adapter gateway directly to game clients.

## Current limitations

This first gateway implements registration, heartbeat, inspection, and disconnect only. It does not yet provide:
- a player/admin authentication endpoint;
- generic request/event dispatch;
- a persistent queue for actions from AI Core to adapters;
- WebSocket streaming;
- built-in TLS termination;
- rate limiting and credential administration APIs;
- durable adapter registry or credentials.

These will be added as explicit protocol features rather than hidden side effects.
