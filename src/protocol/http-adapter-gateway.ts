import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { SampAiError } from "../core/errors.js";
import {
  AdapterRegistry,
  type AuthenticatedAdapterIdentity
} from "../adapters/adapter-registry.js";

export interface AdapterAuthenticator {
  authenticate(
    authorizationHeader: string | undefined
  ): Promise<AuthenticatedAdapterIdentity | undefined>;
}

export interface HttpAdapterGatewayOptions {
  readonly maxBodyBytes?: number;
  readonly requestTimeoutMs?: number;
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTaskResult(value: unknown): AdapterTaskResult {
  if (!isRecord(value)) {
    throw new HttpRequestError("Task result must be a JSON object.", 400);
  }

  if (
    value.status !== "succeeded" &&
    value.status !== "partially_succeeded" &&
    value.status !== "failed"
  ) {
    throw new HttpRequestError("Task result status is invalid.", 400);
  }

  if (value.status === "failed") {
    if (
      !isRecord(value.error) ||
      typeof value.error.code !== "string" ||
      typeof value.error.message !== "string"
    ) {
      throw new HttpRequestError("Failed task results require error.code and error.message.", 400);
    }

    return {
      status: "failed",
      error: {
        code: value.error.code,
        message: value.error.message
      }
    };
  }

  if (!Object.prototype.hasOwnProperty.call(value, "output")) {
    throw new HttpRequestError("Successful task results require an output field.", 400);
  }

  return {
    status: value.status,
    output: value.output
  };
}

export class HttpAdapterGateway {
  private server?: Server;

  constructor(
    private readonly adapters: AdapterRegistry,
    private readonly authenticator: AdapterAuthenticator,
    private readonly options: HttpAdapterGatewayOptions = {},
    private readonly tasks?: AdapterTaskQueue
  ) {}

  async listen(
    port = 8787,
    host = "127.0.0.1"
  ): Promise<{ host: string; port: number }> {
    if (this.server) {
      throw new Error("HTTP adapter gateway is already listening.");
    }

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    server.requestTimeout = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    server.headersTimeout = Math.min(server.requestTimeout, 10_000);
    server.keepAliveTimeout = 5_000;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    this.server = server;
    const address = server.address();

    if (!address || typeof address === "string") {
      await this.close();
      throw new Error("HTTP adapter gateway could not determine its bound address.");
    }

    return { host, port: address.port };
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;

    this.server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      this.sendJson(response, 200, {
        ok: true,
        service: "samp-ai-adapter-gateway"
      });
      return;
    }

    const taskRoute = /^\\/v1\\/adapters\\/tasks\\/([0-9a-f-]{36})\\/(renew|result)$/i.exec(path);
    const isTaskRoute =
      path === "/v1/adapters/tasks/next" ||
      taskRoute !== null;

    if (
      path !== "/v1/adapters/hello" &&
      path !== "/v1/adapters/heartbeat" &&
      path !== "/v1/adapters/me" &&
      !isTaskRoute
    ) {
      this.sendJson(response, 404, {
        error: { code: "NOT_FOUND", message: "Route not found." }
      });
      return;
    }

    let identity: AuthenticatedAdapterIdentity | undefined;
    try {
      identity = await this.authenticator.authenticate(
        request.headers.authorization
      );
    } catch {
      this.sendJson(response, 401, {
        error: { code: "AUTHENTICATION_FAILED", message: "Adapter authentication failed." }
      });
      return;
    }

    if (!identity) {
      this.sendJson(response, 401, {
        error: { code: "AUTHENTICATION_REQUIRED", message: "Valid adapter credentials are required." }
      });
      return;
    }

    try {
      if (request.method === "POST" && path === "/v1/adapters/hello") {
        this.assertJsonContentType(request);
        const payload = await this.readJsonBody(request);
        const registered = this.adapters.registerHello(payload, identity);

        this.sendJson(response, 201, {
          ok: true,
          adapter: {
            adapter_id: registered.adapterId,
            server_instance_id: registered.serverInstanceId,
            runtime: registered.runtime,
            version: registered.version,
            protocol: registered.protocol,
            capabilities: registered.capabilities,
            limits: registered.limits,
            connected_at: registered.connectedAt,
            last_seen_at: registered.lastSeenAt
          }
        });
        return;
      }

      if (request.method === "POST" && path === "/v1/adapters/heartbeat") {
        const registered = this.adapters.touch(
          identity.serverInstanceId,
          identity.adapterId
        );

        this.sendJson(response, 200, {
          ok: true,
          server_instance_id: registered.serverInstanceId,
          adapter_id: registered.adapterId,
          last_seen_at: registered.lastSeenAt
        });
        return;
      }

      if (request.method === "GET" && path === "/v1/adapters/me") {
        const registered = this.adapters.getAdapter(
          identity.serverInstanceId,
          identity.adapterId
        );

        this.sendJson(response, 200, {
          ok: true,
          adapter_id: registered.adapterId,
          server_instance_id: registered.serverInstanceId,
          protocol: registered.protocol,
          runtime: registered.runtime,
          capabilities: registered.capabilities
        });
        return;
      }

      if (request.method === "DELETE" && path === "/v1/adapters/me") {
        const removed = this.adapters.unregister(
          identity.serverInstanceId,
          identity.adapterId
        );

        this.sendJson(response, 200, { ok: true, removed });
        return;
      }

      if (isTaskRoute && !this.tasks) {
        this.sendJson(response, 503, {
          error: { code: "TASK_QUEUE_UNAVAILABLE", message: "Adapter task queue is not configured." }
        });
        return;
      }

      if (request.method === "GET" && path === "/v1/adapters/tasks/next") {
        // Polling also refreshes the adapter's liveness.
        this.adapters.touch(identity.serverInstanceId, identity.adapterId);

        const task = this.tasks!.claimNext(
          identity.serverInstanceId,
          identity.adapterId
        );

        if (!task) {
          response.writeHead(204, {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          });
          response.end();
          return;
        }

        this.sendJson(response, 200, {
          ok: true,
          task
        });
        return;
      }

      if (taskRoute && request.method === "POST") {
        this.assertJsonContentType(request);
        const body = await this.readJsonBody(request);
        if (!isRecord(body) || typeof body.lease_token !== "string") {
          throw new HttpRequestError("Request requires a lease_token.", 400);
        }

        const taskId = taskRoute[1]!;
        const operation = taskRoute[2]!;

        if (operation === "renew") {
          const task = this.tasks!.renewLease(
            identity.serverInstanceId,
            identity.adapterId,
            taskId,
            body.lease_token
          );

          this.sendJson(response, 200, { ok: true, task });
          return;
        }

        const result = parseTaskResult(body.result);
        const completed = this.tasks!.complete(
          identity.serverInstanceId,
          identity.adapterId,
          taskId,
          body.lease_token,
          result
        );

        this.sendJson(response, 200, {
          ok: true,
          task: completed
        });
        return;
      }

      this.sendJson(response, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." }
      });
    } catch (error) {
      if (error instanceof HttpRequestError) {
        this.sendJson(response, error.statusCode, {
          error: { code: "INVALID_REQUEST", message: error.message }
        });
        return;
      }

      if (error instanceof SampAiError) {
        const statusCode =
          error.code === "ADAPTER_IDENTITY_MISMATCH" ? 403 :
          error.code === "ADAPTER_NOT_CONNECTED" ? 404 :
          error.code === "ADAPTER_STALE" ? 503 :
          error.code === "TASK_QUEUE_FULL" ? 429 :
          error.code === "TASK_NOT_FOUND" ? 404 :
          error.code === "TASK_LEASE_INVALID" ? 409 :
          error.code === "TASK_EXPIRED" ? 409 :
          error.code === "PROTOCOL_VERSION_UNSUPPORTED" ? 426 : 400;

        this.sendJson(response, statusCode, {
          error: { code: error.code, message: error.message }
        });
        return;
      }

      this.sendJson(response, 500, {
        error: { code: "INTERNAL_ERROR", message: "The adapter gateway could not process the request." }
      });
    }
  }

  private assertJsonContentType(request: IncomingMessage): void {
    const contentType = request.headers["content-type"] ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new HttpRequestError("Content-Type must be application/json.", 415);
    }
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const maxBytes = this.options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const declaredLength = Number(request.headers["content-length"] ?? 0);

    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new HttpRequestError("Request body is too large.", 413);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;

      if (totalBytes > maxBytes) {
        throw new HttpRequestError("Request body is too large.", 413);
      }

      chunks.push(buffer);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new HttpRequestError("Request body must contain valid JSON.", 400);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpRequestError("Request body must be a JSON object.", 400);
    }

    return parsed;
  }

  private sendJson(
    response: ServerResponse,
    statusCode: number,
    body: Record<string, unknown>
  ): void {
    if (response.headersSent || response.destroyed) return;

    const serialized = JSON.stringify(body);
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(serialized),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(serialized);
  }
}
