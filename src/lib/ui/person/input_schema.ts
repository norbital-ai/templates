/**
 * A version's input schemas (`employee_input_schema`, `entity_input_schema`) as the schemas the facts forms render, and
 * which keys they require (`required`, and an `allOf` / top-level `if` → `then.required` keyed on other values).
 * Nothing here names a key the schema does not.
 */
import { Schema } from 'effect';
import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';

const isString = Schema.is(Schema.String);
export const strings = (value: unknown): readonly string[] =>
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

const split = (value: JsonObject, keys: readonly string[], keep: boolean): JsonObject =>
	Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key) === keep));
/** The keys of `value` its form edits: all but `skip`. */
export const formValue = (value: JsonObject, skip: readonly string[]): JsonObject =>
	split(value, skip, false);
/** A form's edit written back over the `skip` keys of `value` it never shows. */
export const fromForm = (
	value: JsonObject,
	skip: readonly string[],
	next: unknown
): JsonObject => ({
	...split(value, skip, true),
	...(isJsonObject(next) ? split(next, skip, false) : {})
});

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
	const properties = isJsonObject(node?.properties) ? node.properties : {};
	const nested = Object.entries(properties).flatMap(([key, entry]) => {
		if (!isJsonObject(entry) || entry.type !== 'object') return [];
		const held = value[key];
		return missingRequired(entry, isJsonObject(held) ? held : {}).map((inner) => `${key}.${inner}`);
	});
	return [...own, ...nested];
}
