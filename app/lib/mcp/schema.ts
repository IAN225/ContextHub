export type Schema = {
  type?:
    | 'object'
    | 'array'
    | 'string'
    | 'integer'
    | 'number'
    | 'boolean'
    | 'null';
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
  anyOf?: Schema[];
  enum?: (string | number)[];
  const?: string | number | boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  maxItems?: number;
  'x-maxUtf8Bytes'?: number;
};
export const str = (description = '', maxLength?: number): Schema => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...(maxLength === undefined ? {} : { maxLength }),
});
export const integer = (
  minimum = 0,
  maximum?: number,
  fallback?: number,
): Schema => ({
  type: 'integer',
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
  ...(fallback === undefined ? {} : { default: fallback }),
});
export const choice = (values: string[], fallback?: string): Schema => ({
  type: 'string',
  enum: values,
  ...(fallback === undefined ? {} : { default: fallback }),
});
export const obj = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const array = (items: Schema, maxItems?: number): Schema => ({
  type: 'array',
  items,
  ...(maxItems === undefined ? {} : { maxItems }),
});
export const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: 'null' }],
});
export const boolean: Schema = { type: 'boolean' };
export const revision: Schema = {
  ...str('版本凭据；原样使用读取结果', 64),
  minLength: 64,
  pattern: '^[a-f0-9]{64}$',
};
export const requestId: Schema = {
  ...str('写入唯一编号；重试复用同一编号和参数，新操作换新编号', 128),
  minLength: 1,
  pattern: '^[a-zA-Z0-9_.:-]+$',
};
export const id = { ...str('记录 ID', 200), minLength: 1 };
export const title = { ...str('标题', 200), pattern: '\\S' };
export const sourceRange = obj({
  from_turn: integer(1, 1000000),
  to_turn: integer(1, 1000000),
  revision,
});
