/**
 * A version's input schemas (`employee_input_schema`, `entity_input_schema`) as the schemas the facts forms render, and
 * which keys they require (`required`, and an `allOf` / top-level `if` → `then.required` keyed on other values).
 * Nothing here names a key the schema does not.
 */
import type { Row } from '@norbital-ai/bolt';
import { Option, Schema } from 'effect';
import type { JsonObject } from '../../payroll_engine/foundation.js';
import { asObject, isJsonRecord } from '../records/json_object.js';

/**
 * A JSON Schema node in the keywords these forms and the kit's renderer read (decoded once where a document enters a
 * page). Every other keyword (`format`, `minimum`, …) is kept as stored and read only by the kit's validator.
 */
export type JsonSchemaNode = {
	readonly $ref?: string;
	readonly type?: string | readonly string[];
	readonly title?: string;
	readonly description?: string;
	readonly properties?: { readonly [key: string]: JsonSchemaNode };
	readonly required?: readonly string[];
	readonly items?: JsonSchemaNode;
	readonly enum?: readonly Schema.Json[];
	readonly const?: Schema.Json;
	readonly default?: Schema.Json;
	readonly readOnly?: boolean;
	readonly 'x-norbital'?: {
		readonly datatype?: string;
		readonly section?: string;
		readonly advanced?: boolean;
		readonly order?: number;
	};
	readonly allOf?: readonly JsonSchemaNode[];
	readonly if?: JsonSchemaNode;
	readonly then?: JsonSchemaNode;
	readonly [keyword: string]: unknown;
};

const JsonSchemaNode: Schema.Codec<JsonSchemaNode> = Schema.suspend(() =>
	Schema.StructWithRest(
		Schema.Struct({
			$ref: Schema.optionalKey(Schema.String),
			type: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
			title: Schema.optionalKey(Schema.String),
			description: Schema.optionalKey(Schema.String),
			properties: Schema.optionalKey(Schema.Record(Schema.String, JsonSchemaNode)),
			required: Schema.optionalKey(Schema.Array(Schema.String)),
			items: Schema.optionalKey(JsonSchemaNode),
			enum: Schema.optionalKey(Schema.Array(Schema.Json)),
			const: Schema.optionalKey(Schema.Json),
			default: Schema.optionalKey(Schema.Json),
			readOnly: Schema.optionalKey(Schema.Boolean),
			'x-norbital': Schema.optionalKey(
				Schema.Struct({
					datatype: Schema.optionalKey(Schema.String),
					section: Schema.optionalKey(Schema.String),
					advanced: Schema.optionalKey(Schema.Boolean),
					order: Schema.optionalKey(Schema.Number)
				})
			),
			allOf: Schema.optionalKey(Schema.Array(JsonSchemaNode)),
			if: Schema.optionalKey(JsonSchemaNode),
			then: Schema.optionalKey(JsonSchemaNode)
		}),
		// every other keyword is kept as stored, for the kit's validator
		[Schema.Record(Schema.String, Schema.Json)]
	)
);

const decodeJsonSchema = Schema.decodeUnknownOption(JsonSchemaNode);
/** A stored input schema as its typed tree, every keyword kept; null when it is absent, masked or not one. */
export const jsonSchemaOf = (
	value: Row<'jurisdiction_settings'>['employee_input_schema'] | undefined
): JsonSchemaNode | null => Option.getOrNull(decodeJsonSchema(value));

/** The term keys the terms forms edit themselves (range, salary, allowances, pattern) or never edit (ids). */
export const TERM_KEYS = [
	'id',
	'employment_id',
	'effective_range',
	'base_salary',
	'currency',
	'allowances',
	'shift_pattern_id'
] as const;

/** The node at a path of property names under `properties` (an array steps into its `items`). */
export function schemaAt(
	schema: JsonSchemaNode | null,
	...keys: readonly string[]
): JsonSchemaNode | null {
	let node = schema;
	for (const key of keys) {
		node = node?.properties?.[key] ?? null;
		if (node?.type === 'array') node = node.items ?? null;
	}
	return node;
}

const split = (value: JsonObject, keys: readonly string[], keep: boolean): JsonObject =>
	Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key) === keep));
/** The keys of `value` its form edits: all but `skip`. */
export const formValue = (value: JsonObject, skip: readonly string[]): JsonObject =>
	split(value, skip, false);
/** A form's edit written back over the `skip` keys of `value` it never shows (the kit's form hands back a `Value`). */
export const fromForm = (
	value: JsonObject,
	skip: readonly string[],
	next: unknown
): JsonObject => ({
	...split(value, skip, true),
	...split(asObject(next) ?? {}, skip, false)
});

const blank = (held: Schema.Json | undefined) => held == null || held === '';

const matches = (condition: JsonSchemaNode | undefined, value: JsonObject): boolean =>
	condition !== undefined &&
	!(condition.required ?? []).some((key) => blank(value[key])) &&
	Object.entries(condition.properties ?? {}).every(
		([key, rule]) =>
			!('const' in rule && rule.const !== value[key]) &&
			(rule.enum === undefined || rule.enum.includes(value[key] ?? null))
	);

/** The keys a node requires of `value`: its `required`, and each `if` that holds's `then.required`. */
export function requiredOf(node: JsonSchemaNode | null, value: JsonObject): readonly string[] {
	if (node == null) return [];
	const out = new Set(node.required);
	for (const rule of [node, ...(node.allOf ?? [])])
		if (rule.then !== undefined && matches(rule.if, value))
			for (const key of rule.then.required ?? []) out.add(key);
	return [...out];
}

/** The required keys of `value` (and of its declared object members) left blank, as `key` or `parent.key`. */
export function missingRequired(node: JsonSchemaNode | null, value: JsonObject): readonly string[] {
	const own = requiredOf(node, value).filter((key) => blank(value[key]));
	const nested = Object.entries(node?.properties ?? {}).flatMap(([key, entry]) => {
		if (entry.type !== 'object') return [];
		const held = value[key];
		return missingRequired(entry, isJsonRecord(held) ? held : {}).map((inner) => `${key}.${inner}`);
	});
	return [...own, ...nested];
}
