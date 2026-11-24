import { SampAiError } from "../core/errors.js";
import type {
  AgentMessage,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
  ProviderToolCall
} from "../agent/contracts.js";

export interface OpenAIResponsesProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxOutputTokens?: number;
  /** Injection point for deterministic tests and compatible gateways. */
  readonly fetcher?: typeof fetch;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value[field] === "string" ? value[field] as string : undefined;
}

function parseToolArguments(value: unknown, callId: string): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new SampAiError(
        "OpenAI returned invalid JSON arguments for tool call " + callId + ".",
        "PROVIDER_INVALID_TOOL_ARGUMENTS"
      );
    }
  }

  if (isRecord(value) || Array.isArray(value)) {
    return value;
  }

  throw new SampAiError(
    "OpenAI returned missing or unsupported arguments for tool call " + callId + ".",
    "PROVIDER_INVALID_TOOL_ARGUMENTS"
  );
}

function toResponsesInput(messages: readonly AgentMessage[]): JsonObject[] {
  const input: JsonObject[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      input.push({
        role: "user",
        content: message.content
      });
      continue;
    }

    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content
      });
      continue;
    }

    if (message.content.trim()) {
      input.push({
        role: "assistant",
        content: message.content
      });
    }

    for (const call of message.toolCalls ?? []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments)
      });
    }
  }

  return input;
}

function extractResponse(payload: unknown): ModelProviderResponse {
  if (!isRecord(payload)) {
    throw new SampAiError(
      "OpenAI Responses API returned an invalid response envelope.",
      "PROVIDER_INVALID_RESPONSE"
    );
  }

  if (payload.status === "failed") {
    const errorMessage = getString(payload.error, "message");
    throw new SampAiError(
      errorMessage ?? "OpenAI Responses API reported a failed response.",
      "PROVIDER_RESPONSE_FAILED"
    );
  }

  if (!Array.isArray(payload.output)) {
    throw new SampAiError(
      "OpenAI Responses API response did not contain an output array.",
      "PROVIDER_INVALID_RESPONSE"
    );
  }

  const textParts: string[] = [];
  const toolCalls: ProviderToolCall[] = [];

  for (const item of payload.output) {
    if (!isRecord(item)) continue;

    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isRecord(part)) continue;

        if (part.type === "output_text" && typeof part.text === "string") {
          textParts.push(part.text);
        } else if (part.type === "refusal" && typeof part.refusal === "string") {
          textParts.push(part.refusal);
        }
      }

      continue;
    }

    if (item.type === "function_call") {
      const callId = getString(item, "call_id");
      const name = getString(item, "name");

      if (!callId || !name) {
        throw new SampAiError(
          "OpenAI returned a function call without call_id or name.",
          "PROVIDER_INVALID_TOOL_CALL"
        );
      }

      toolCalls.push({
        id: callId,
        name,
        arguments: parseToolArguments(item.arguments, callId)
      });
    }
  }

  // Some compatible gateways expose output_text directly; use it only as a fallback.
  const outputText = textParts.length > 0
    ? textParts.join("\n")
    : getString(payload, "output_text") ?? "";

  return {
    content: outputText,
    ...(toolCalls.length > 0 ? { toolCalls } : {})
  };
}

export class OpenAIResponsesProvider implements ModelProvider {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: OpenAIResponsesProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new SampAiError("OpenAI API key is required.", "PROVIDER_CONFIGURATION_INVALID");
    }

    if (!options.model.trim()) {
      throw new SampAiError("OpenAI model is required.", "PROVIDER_CONFIGURATION_INVALID");
    }

    const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new SampAiError("OpenAI base URL must be a valid URL.", "PROVIDER_CONFIGURATION_INVALID");
    }

    const isLoopback =
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "127.0.0.1" ||
      parsedUrl.hostname === "[::1]";

    if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLoopback)) {
      throw new SampAiError(
        "OpenAI base URL must use HTTPS. Plain HTTP is allowed only for loopback development.",
        "PROVIDER_CONFIGURATION_INVALID"
      );
    }

    this.endpoint = baseUrl + "/responses";
    this.fetcher = options.fetcher ?? globalThis.fetch;

    if (typeof this.fetcher !== "function") {
      throw new SampAiError("This runtime does not provide fetch().", "PROVIDER_CONFIGURATION_INVALID");
    }

    if (
      options.maxOutputTokens !== undefined &&
      (!Number.isInteger(options.maxOutputTokens) ||
        options.maxOutputTokens < 16 ||
        options.maxOutputTokens > 32_000)
    ) {
      throw new SampAiError(
        "maxOutputTokens must be an integer between 16 and 32000.",
        "PROVIDER_CONFIGURATION_INVALID"
      );
    }
  }

  async complete(request: ModelProviderRequest): Promise<ModelProviderResponse> {
    if (request.signal.aborted) {
      throw new SampAiError("Provider request was cancelled.", "PROVIDER_CANCELLED");
    }

    const tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false
    }));

    const body: Record<string, unknown> = {
      model: this.options.model,
      instructions: request.systemInstructions,
      input: toResponsesInput(request.messages),
      tools
    };

    if (this.options.maxOutputTokens !== undefined) {
      body.max_output_tokens = this.options.maxOutputTokens;
    }

    let response: Response;

    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + this.options.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: request.signal
      });
    } catch (error) {
      if (request.signal.aborted) {
        throw new SampAiError("Provider request was cancelled.", "PROVIDER_CANCELLED");
      }

      throw new SampAiError(
        error instanceof Error ? error.message : "Network request to OpenAI failed.",
        "PROVIDER_NETWORK_ERROR"
      );
    }

    const rawPayload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const errorObject = isRecord(rawPayload) ? rawPayload.error : undefined;
      const message = getString(errorObject, "message");
      throw new SampAiError(
        "OpenAI Responses API returned HTTP " + response.status + ": " +
          (message ?? "request failed"),
        "PROVIDER_HTTP_ERROR"
      );
    }

    return extractResponse(rawPayload);
  }
}
