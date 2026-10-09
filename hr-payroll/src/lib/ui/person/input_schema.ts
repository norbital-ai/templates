/**
 * A form read from a version's input schema (`employee_input_schema`): the fields an object node declares, their
 * options (`enum`), and which are required (`required`, and an `allOf` / top-level `if` → `then.required` keyed on
 * other values). Nothing here names a key the schema does not.
 */
import { Schema } from 'effect';
import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';

const isString = Schema.is(Schema.String);
const strings = (value: unknown): readonly string[] =>
	Array.isArray(value) ? value.filter(isString) : [];

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

export type SchemaField = {
	readonly key: string;
	readonly kind: 'enum' | 'boolean' | 'number' | 'date' | 'text' | 'object';
	readonly title: string;
	readonly description: string;
	readonly options: readonly Schema.Json[];
	/** The schema's documented default, shown as a hint and never written. */
	readonly hint: string;
	readonly node: JsonObject;
};

/** The node at a path of property names under `properties` (an array steps into its `items`). */
export function schemaAt(schema: unknown, ...keys: readonly string[]): JsonObject | null {
	let node: unknown = schema;
	for (const key of keys) {
		const properties = isJsonObject(node) ? node.properties : undefined;
		node = isJsonObject(properties) ? properties[key] : undefined;
		if (isJsonObject(node) && node.type === 'array') node = node.items;
	}
	return isJsonObject(node) ? node : null;
}

const kindOf = (node: JsonObject): SchemaField['kind'] => {
	if (Array.isArray(node.enum)) return 'enum';
	const types = Array.isArray(node.type) ? node.type : [node.type];
	if (types.includes('boolean')) return 'boolean';
	if (types.includes('number') || types.includes('integer')) return 'number';
	if (types.includes('object')) return 'object';
	return node.format === 'date' ? 'date' : 'text';
};

/** The scalar and object fields an object node declares, in order, less `skip`; arrays are left to their caller. */
export function fieldsOf(node: JsonObject | null, skip: readonly string[] = []): SchemaField[] {
	const properties = isJsonObject(node?.properties) ? node.properties : {};
	return Object.entries(properties).flatMap(([key, entry]) => {
		if (skip.includes(key) || !isJsonObject(entry) || entry.type === 'array' || 'const' in entry)
			return [];
		return [
			{
				key,
				kind: kindOf(entry),
				title: isString(entry.title) ? entry.title : key,
				description: isString(entry.description) ? entry.description : '',
				options: Array.isArray(entry.enum) ? entry.enum : [],
				hint: entry.default == null ? '' : String(entry.default),
				node: entry
			}
		];
	});
}

const matches = (condition: unknown, value: JsonObject): boolean => {
	if (!isJsonObject(condition)) return false;
	if (strings(condition.required).some((key) => value[key] == null || value[key] === ''))
		return false;
	const properties = isJsonObject(condition.properties) ? condition.properties : {};
	return Object.entries(properties).every(([key, rule]) => {
		if (!isJsonObject(rule)) return true;
		if ('const' in rule && rule.const !== value[key]) return false;
		return !Array.isArray(rule.enum) || rule.enum.includes(value[key] ?? null);
	});
};

/** The keys a node requires of `value`: its `required`, and each `if` that holds's `then.required`. */
export function requiredOf(node: JsonObject | null, value: JsonObject): readonly string[] {
	if (node == null) return [];
	const out = new Set(strings(node.required));
	const rules = [node, ...(Array.isArray(node.allOf) ? node.allOf : [])];
	for (const rule of rules)
		if (isJsonObject(rule) && isJsonObject(rule.then) && matches(rule.if, value))
			for (const key of strings(rule.then.required)) out.add(key);
	return [...out];
}

/** The required keys of `value` (and of its declared object members) left blank, as `key` or `parent.key`. */
export function missingRequired(node: JsonObject | null, value: JsonObject): readonly string[] {
	const blank = (held: unknown) => held == null || held === '';
	const own = requiredOf(node, value).filter((key) => blank(value[key]));
	const nested = fieldsOf(node)
		.filter((field) => field.kind === 'object')
		.flatMap((field) => {
			const held = value[field.key];
			return missingRequired(field.node, isJsonObject(held) ? held : {}).map(
				(key) => `${field.key}.${key}`
			);
		});
	return [...own, ...nested];
}
