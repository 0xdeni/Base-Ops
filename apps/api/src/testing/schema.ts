/**
 * A small validator for the JSON Schema subset `src/agentDocs/openapi.json` uses (`$ref`,
 * `anyOf`, `type` incl. type arrays, `properties`, `required`, `items`, `enum`, `const`,
 * `pattern`, `minimum`, `maximum`, `maxLength`, `maxItems`), so tests can check real responses against the
 * hand-written document without a schema dependency.
 *
 * It is stricter than JSON Schema in one way, on purpose: an object property the schema does not
 * list is an error, so a field the API sends but the document forgets is caught.
 */

export interface Schema {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  enum?: unknown[]
  const?: unknown
  anyOf?: Schema[]
  pattern?: string
  minimum?: number
  maximum?: number
  maxLength?: number
  maxItems?: number
}

/** The node a local `#/a/b/c` reference points at; throws for a dangling reference. */
export function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`only local references are supported: ${ref}`)
  let node: unknown = doc
  for (const key of ref.slice(2).split('/')) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) {
      throw new Error(`dangling reference ${ref}`)
    }
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** Every `$ref` string anywhere in `node`. */
export function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) collectRefs(item, out)
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value)
      else collectRefs(value, out)
    }
  }
  return out
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function hasType(value: unknown, type: string): boolean {
  const actual = jsonType(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

function validateObject(doc: unknown, schema: Schema, value: object, path: string): string[] {
  const errors: string[] = []
  const record = value as Record<string, unknown>
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(record, key)) errors.push(`${path}.${key}: required but missing`)
  }
  for (const [key, child] of Object.entries(record)) {
    const sub = schema.properties?.[key]
    if (sub === undefined) errors.push(`${path}.${key}: not documented`)
    else errors.push(...validate(doc, sub, child, `${path}.${key}`))
  }
  return errors
}

function validateScalar(schema: Schema, value: unknown, path: string): string[] {
  const errors: string[] = []
  if (schema.enum !== undefined && !schema.enum.includes(value))
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
  if (Object.hasOwn(schema, 'const') && value !== schema.const)
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}`)
  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: "${value}" does not match ${schema.pattern}`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path}: longer than ${schema.maxLength}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: ${value} < ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: ${value} > ${schema.maximum}`)
  }
  return errors
}

/** The problems of `value` against `schema` (empty when it conforms); `doc` resolves `$ref`s. */
export function validate(doc: unknown, schema: Schema, value: unknown, path = '$'): string[] {
  if (schema.$ref !== undefined) {
    return validate(doc, resolvePointer(doc, schema.$ref) as Schema, value, path)
  }
  if (schema.anyOf !== undefined) {
    const branches = schema.anyOf.map((branch) => validate(doc, branch, value, path))
    if (branches.some((problems) => problems.length === 0)) return []
    return [`${path}: matches no anyOf branch (${branches.map((p) => p[0]).join(' | ')})`]
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => hasType(value, type))) {
      return [`${path}: expected ${types.join(' | ')}, got ${jsonType(value)}`]
    }
  }
  const errors = validateScalar(schema, value, path)
  if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems)
    errors.push(`${path}: more than ${schema.maxItems} items`)
  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items
    value.forEach((item, index) => {
      errors.push(...validate(doc, items, item, `${path}[${index}]`))
    })
  }
  if (jsonType(value) === 'object' && schema.properties !== undefined) {
    errors.push(...validateObject(doc, schema, value as object, path))
  }
  return errors
}
