import { SampAiError } from "../core/errors.js";
import type {
  CompensationStrategy,
  JsonSchema,
  RiskLevel,
  ToolEffect
} from "../shared/contracts.js";

export interface AdapterActionDefinition {
  readonly id: string;
  readonly description: string;
  readonly requiredCapabilities: readonly string[];
  readonly effect: ToolEffect;
  readonly risk: RiskLevel;
  readonly idempotent: boolean;
  readonly compensation: CompensationStrategy;
  readonly payloadSchema: JsonSchema;
  readonly resultSchema: JsonSchema;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as unknown as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export class AdapterActionRegistry {
  private readonly actions = new Map<string, AdapterActionDefinition>();

  register(definition: AdapterActionDefinition): void {
    if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(definition.id)) {
      throw new Error("Adapter action IDs must use a stable dotted identifier.");
    }

    if (this.actions.has(definition.id)) {
      throw new Error("Adapter action is already registered: " + definition.id);
    }

    if (definition.requiredCapabilities.length === 0) {
      throw new Error("Adapter actions must require at least one capability.");
    }

    const snapshot = deepFreeze(structuredClone(definition));
    this.actions.set(snapshot.id, snapshot);
  }

  get(actionId: string): AdapterActionDefinition {
    const definition = this.actions.get(actionId);

    if (!definition) {
      throw new SampAiError(
        "Adapter action is not registered: " + actionId,
        "ADAPTER_ACTION_NOT_REGISTERED"
      );
    }

    return definition;
  }

  list(): readonly AdapterActionDefinition[] {
    return Object.freeze([...this.actions.values()]);
  }
}
