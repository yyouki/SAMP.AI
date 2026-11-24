import type { AnySchema } from "ajv";
import { JsonSchemaValidator } from "../validation/json-schema-validator.js";

export interface ProtocolMessage {
  readonly protocol: string;
  readonly message_id: string;
  readonly type: "request" | "response" | "event";
  readonly server_instance_id: string;
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

export interface AdapterHelloMessage extends ProtocolMessage {
  readonly type: "event";
  readonly event: "adapter.hello";
  readonly payload: {
    readonly adapter: {
      readonly name: string;
      readonly version: string;
      readonly runtime: string;
      readonly runtime_version?: string;
    };
    readonly capabilities: readonly string[];
    readonly limits: {
      readonly max_operations_per_batch: number;
      readonly max_objects_per_project: number;
    };
  };
}

export class ProtocolValidator {
  constructor(private readonly schemas: JsonSchemaValidator) {}

  validateMessage(value: unknown): ProtocolMessage {
    return this.schemas.assert<ProtocolMessage>(
      "https://raw.githubusercontent.com/yyouki/SAMP.AI/main/schemas/protocol/message.schema.json",
      value,
      "protocol message"
    );
  }

  validateAdapterHello(value: unknown): AdapterHelloMessage {
    return this.schemas.assert<AdapterHelloMessage>(
      "https://raw.githubusercontent.com/yyouki/SAMP.AI/main/schemas/protocol/adapter-hello.schema.json",
      value,
      "adapter hello"
    );
  }

  validateCoordinate<T = unknown>(value: unknown): T {
    return this.schemas.assert<T>(
      "https://raw.githubusercontent.com/yyouki/SAMP.AI/main/schemas/protocol/coordinate.schema.json",
      value,
      "coordinate"
    );
  }
}
