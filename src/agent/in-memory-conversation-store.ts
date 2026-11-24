import type {
  ConversationStore,
  AgentMessage
} from "./contracts.js";

export class InMemoryAgentConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, AgentMessage[]>();

  async load(conversationKey: string): Promise<readonly AgentMessage[]> {
    return structuredClone(this.sessions.get(conversationKey) ?? []);
  }

  async append(
    conversationKey: string,
    messages: readonly AgentMessage[]
  ): Promise<void> {
    const current = this.sessions.get(conversationKey) ?? [];
    current.push(...structuredClone(messages));
    this.sessions.set(conversationKey, current);
  }

  async clear(conversationKey: string): Promise<void> {
    this.sessions.delete(conversationKey);
  }
}
