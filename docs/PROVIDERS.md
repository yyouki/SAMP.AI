# Model Providers

## Provider-neutral design

SAMP.AI Core depends on the `ModelProvider` interface in `src/agent/contracts.ts`. Providers convert that common contract into a vendor-specific API request and convert the response back into `ModelProviderResponse`.

A provider must not execute game-server tools itself. Tool calls returned by the model are routed by `AgentRunner` through the active skill allowlist, permission engine, validator, audit sink, and adapter.

## OpenAI Responses API adapter

The first optional provider is `OpenAIResponsesProvider`.

The implementation:
- uses the Responses API over Node.js `fetch`;
- maps SAMP.AI provider tools to function tools;
- maps returned `function_call` items into the provider-neutral tool-call contract;
- sends prior tool results as `function_call_output` items with the matching `call_id`;
- accepts an injected fetch implementation for deterministic tests;
- passes the agent AbortSignal to the HTTP request;
- avoids logging or returning the API key in provider errors;
- requires HTTPS for non-loopback provider URLs, allowing plain HTTP only for local development.

OpenAI's official migration documentation states that the Assistants API was sunset on August 26, 2026 and directs new integrations to the Responses API. The Responses API returns output items and leaves application-managed tool-call loops to the integrating application. See the [official migration guide](https://platform.openai.com/docs/assistants/migration).

## Configuration example

```ts
import { OpenAIResponsesProvider } from "./src/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not configured.");
}

const provider = new OpenAIResponsesProvider({
  apiKey,
  model: process.env.SAMP_AI_MODEL ?? "gpt-6",
  maxOutputTokens: 2048
});
```

The model name above is an example configuration value. Use a model available to the API project.

Do not commit `.env` files or API keys. Keep secrets on the AI backend, never inside Pawn scripts, game clients, adapter configuration shipped to players, or public repositories.

## Adding another provider

Implement `ModelProvider.complete()` and map:
- system instructions;
- user/assistant history;
- prior tool calls;
- prior tool results;
- available function schemas;
- provider response text and tool calls;
- cancellation and provider errors.

The provider must not bypass SAMP.AI's tool dispatcher or invoke tools directly. Add mock-fetch tests for successful text, tool calls, malformed arguments, API errors, and cancellation.
