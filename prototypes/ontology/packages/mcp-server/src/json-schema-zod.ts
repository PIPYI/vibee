import { z } from "zod";

type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  enum?: readonly unknown[];
  const?: unknown;
  oneOf?: readonly JsonSchema[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  items?: JsonSchema;
  additionalProperties?: boolean;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

/** Onto가 사용하는 JSON Schema 부분집합을 MCP SDK가 받는 Zod 계약으로 옮긴다. */
export function jsonSchemaToZod(input: unknown, path = "$input"): z.ZodTypeAny {
  const schema = input as JsonSchema;
  if (!schema || typeof schema !== "object") throw new Error(`${path}: JSON Schema object가 필요합니다.`);

  if (schema.const !== undefined) {
    if (typeof schema.const !== "string" && typeof schema.const !== "number" && typeof schema.const !== "boolean") {
      throw new Error(`${path}: 지원하지 않는 const 값입니다.`);
    }
    return z.literal(schema.const);
  }
  if (schema.enum) {
    if (schema.enum.length === 0 || !schema.enum.every((value) => typeof value === "string")) {
      throw new Error(`${path}: 문자열 enum만 지원합니다.`);
    }
    return z.enum(schema.enum as [string, ...string[]]);
  }
  if (schema.oneOf) {
    const options = schema.oneOf.map((option, index) =>
      jsonSchemaToZod(
        schema.type && !option.type ? { ...option, type: schema.type } : option,
        `${path}.oneOf[${index}]`,
      ),
    );
    if (options.length < 2) throw new Error(`${path}: oneOf에는 둘 이상의 schema가 필요합니다.`);
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  switch (schema.type) {
    case "object": {
      const required = new Set(schema.required ?? []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        const value = jsonSchemaToZod(property, `${path}.${key}`);
        shape[key] = required.has(key) ? value : value.optional();
      }
      const object = z.object(shape);
      return schema.additionalProperties === false ? object.strict() : object.passthrough();
    }
    case "array": {
      if (!schema.items) throw new Error(`${path}: array.items가 필요합니다.`);
      let array = z.array(jsonSchemaToZod(schema.items, `${path}[]`));
      if (schema.minItems !== undefined) array = array.min(schema.minItems);
      return array;
    }
    case "string": {
      let string = z.string();
      if (schema.minLength !== undefined) string = string.min(schema.minLength);
      return string;
    }
    case "integer": {
      let number = z.number().int();
      if (schema.minimum !== undefined) number = number.min(schema.minimum);
      if (schema.maximum !== undefined) number = number.max(schema.maximum);
      return number;
    }
    case "number": {
      let number = z.number();
      if (schema.minimum !== undefined) number = number.min(schema.minimum);
      if (schema.maximum !== undefined) number = number.max(schema.maximum);
      return number;
    }
    case "boolean":
      return z.boolean();
    default:
      throw new Error(`${path}: 지원하지 않는 JSON Schema type입니다.`);
  }
}
