import type { AnySchema } from "ajv";
import manifestSchema from "../../schemas/extensions/manifest.schema.json" with { type: "json" };
import skillSchema from "../../schemas/extensions/skill.schema.json" with { type: "json" };
import toolSchema from "../../schemas/extensions/tool.schema.json" with { type: "json" };
import { JsonSchemaValidator } from "./json-schema-validator.js";

/** Create a validator with the repository's built-in extension schemas registered. */
export function createDefaultSchemaValidator(): JsonSchemaValidator {
  const schemas: AnySchema[] = [
    manifestSchema as AnySchema,
    skillSchema as AnySchema,
    toolSchema as AnySchema
  ];

  return new JsonSchemaValidator(schemas);
}
