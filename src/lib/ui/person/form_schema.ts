/** A version's input-schema nodes as the schemas the facts forms render: page code only (it reads the UI kit). */
import { isJsonSchema, type JsonSchema } from '@norbital-ai/ui';
import { isJsonObject, type JsonObject } from '../../payroll_engine/foundation.js';
import { strings } from './input_schema.js';

/** An object node less `skip` (and its `required` of them) as the schema a facts form renders; null when it is none. */
export function formSchema(
	node: JsonObject | null,
	skip: readonly string[] = []
): JsonSchema | null {
	if (node == null) return null;
	const properties = isJsonObject(node.properties) ? node.properties : {};
	const form = {
		...node,
		properties: Object.fromEntries(
			Object.entries(properties).filter(([key]) => !skip.includes(key))
		),
		...(Array.isArray(node.required)
			? { required: strings(node.required).filter((key) => !skip.includes(key)) }
			: {})
	};
	return isJsonSchema(form) ? form : null;
}

/** The schema of `employment_profile.facts`: the `facts` node's keys beside `employment_statutory_facts`. */
export function profileFactsSchema(schema: unknown): JsonSchema | null {
	if (!isJsonObject(schema)) return null;
	const properties = isJsonObject(schema.properties) ? schema.properties : {};
	const facts: JsonObject = isJsonObject(properties.facts) ? properties.facts : { type: 'object' };
	const own = isJsonObject(facts.properties) ? facts.properties : {};
	const standings = properties.employment_statutory_facts;
	return formSchema({
		...facts,
		properties: standings === undefined ? own : { ...own, employment_statutory_facts: standings }
	});
}
