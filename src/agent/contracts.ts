import type { ApprovalReceipt, JsonSchema } from "../shared/contracts.js";

export type AgentMessage =
  | {
      readonly role: "user" | "assistant";
      readonly content: string;
      readonly toolCalls?: readonly ProviderToolCall[];
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
    };

export interface ProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ProviderTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface ModelProviderRequest {
  readonly systemInstructions: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ProviderTool[];
  readonly signal: AbortSignal;
}

export interface ModelProviderResponse {
  readonly content: string;
  readonly toolCalls?: readonly ProviderToolCall[];
}

export interface ModelProvider {
  complete(request: ModelProviderRequest): Promise<ModelProviderResponse>;
}

export interface ConversationStore {
  load(conversationKey: string): Promise<readonly AgentMessage[]>;
  append(conversationKey: string, messages: readonly AgentMessage[]): Promise<void>;
}

export interface AgentRunLimits {
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly timeoutMs?: number;
}

export interface AgentRunRequest extends AgentRunLimits {
  readonly principal: { readonly subject: string };
  readonly serverInstanceId: string;
  readonly projectId?: string;
  readonly sessionId: string;
  readonly userMessage: string;
  /** Approval receipt loaded by trusted backend approval storage, never from model output. */
  readonly approval?: ApprovalReceipt;
  readonly draftHash?: string;
  readonly signal?: AbortSignal;
}

export interface AgentRunResult {
  readonly conversationKey: string;
  readonly response: string;
  readonly steps: number;
  readonly toolCalls: number;
  readonly stoppedBecause: "completed" | "max_steps" | "max_tool_calls" | "timeout" | "cancelled";
}
