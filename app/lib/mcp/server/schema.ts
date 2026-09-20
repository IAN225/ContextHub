import type { Schema } from '../schema.ts';
import { McpError } from '../contracts.ts';

/** Validates the same JSON Schema subset advertised by tools/list. */
export function validateSchema(
  schema: Schema,
  value: unknown,
  path = 'arguments',
  defaults = true,
): unknown {
  const fail = (reason: string): never => {
    throw new McpError('INVALID_ARGUMENTS', `${path} ${reason}`);
  };
  if (schema.anyOf) {
    for (const branch of schema.anyOf) {
      try {
        return validateSchema(branch, value, path, defaults);
      } catch (error) {
        if (!(error instanceof McpError)) throw error;
      }
    }
    return fail('不符合允许的参数组合。');
  }
  if (schema.type === 'null') {
    if (value !== null) fail('必须为 null。');
    return value;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail('必须是 JSON 对象。');
    const input = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of Object.keys(input))
      if (!Object.hasOwn(properties, key)) fail(`不支持字段 ${key}。`);
    const result: Record<string, unknown> = {};
    for (const [key, rule] of Object.entries(properties)) {
      let v = input[key];
      if (!Object.hasOwn(input, key)) {
        if (defaults && rule.default !== undefined) v = rule.default;
        else if (schema.required?.includes(key))
          return fail(`缺少字段 ${key}。`);
        else continue;
      }
      result[key] = validateSchema(rule, v, `${path}.${key}`, defaults);
    }
    return result;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return fail('必须是数组。');
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      fail('项目过多。');
    return value.map((v, i) =>
      validateSchema(schema.items!, v, `${path}[${i}]`, defaults),
    );
  }
  if (
    schema.type === 'integer'
      ? !Number.isSafeInteger(value)
      : typeof value !== schema.type
  )
    fail('类型无效。');
  if (schema.const !== undefined && schema.const !== value)
    fail('值不符合要求。');
  if (schema.enum && !schema.enum.includes(value as string))
    fail('不在支持范围内。');
  if (typeof value === 'string') {
    if (schema.minLength !== undefined || schema.maxLength !== undefined) {
      const length = Array.from(value).length;
      if (
        length < (schema.minLength ?? 0) ||
        length > (schema.maxLength ?? Infinity)
      )
        fail('长度超出范围。');
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
      fail('格式无效。');
    if (
      schema['x-maxUtf8Bytes'] !== undefined &&
      new TextEncoder().encode(value).length > schema['x-maxUtf8Bytes']
    )
      fail('UTF-8 字节数超出上限。');
  }
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity))
  )
    fail('超出范围。');
  return value;
}
