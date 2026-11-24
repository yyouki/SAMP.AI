import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { SchemaValidationError } from "../core/errors.js";
import type { JsonSchema } from "../shared/contracts.js";

export class JsonSchemaValidator {
  private readonly ajv: Ajv2020;
  private readonly compiled = new WeakMap<object, ValidateFunction>();

  constructor(schemas: readonly AnySchema[] = []) {
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: true
    });

    addFormats(this.ajv);

    for (const schema of schemas) {
      this.ajv.addSchema(schema);
    }
  }

  assert<T>(schema: string | JsonSchema, value: unknown, label = "value"): T {
    const validate = this.resolveValidator(schema);

    if (!validate(value)) {
      const issues = (validate.errors ?? []).map((error) => {
        const path = error.instancePath || "/";
        return `${path}: ${error.message ?? "is invalid"}`;
      });

      throw new SchemaValidationError(
        `Invalid ${label}: ${issues.join("; ")}`,
        issues
      );
    }

    return value as T;
  }

  isValid(schema: string | JsonSchema, value: unknown): boolean {
    return this.resolveValidator(schema)(value) === true;
  }

  private resolveValidator(schema: string | JsonSchema): ValidateFunction {
    if (typeof schema === "string") {
      const validator = this.ajv.getSchema(schema);

      if (!validator) {
        throw new SchemaValidationError(
          `Unknown JSON Schema reference: ${schema}`,
          [`Schema is not registered: ${schema}`]
        );
      }

      return validator;
    }

    const cached = this.compiled.get(schema);

    if (cached) {
      return cached;
    }

    const validator = this.ajv.compile(schema as AnySchema);
    this.compiled.set(schema, validator);
    return validator;
  }
}
