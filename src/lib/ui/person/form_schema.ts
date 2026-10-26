/** A version's input-schema nodes as the schemas the facts forms render: page code only (it reads the UI kit). */
import type { JsonSchema } from '@norbital-ai/ui';
import type { JsonSchemaNode } from './input_schema.js';

/** An object node less `skip` (and its `required` of them) as the schema a facts form renders; null when it is none. */
export function formSchema(
	node: JsonSchemaNode | null,
	skip: readonly string[] = []
): JsonSchema | null {
	if (node == null) return null;
	return {
		...node,
		properties: Object.fromEntries(
			Object.entries(node.properties ?? {}).filter(([key]) => !skip.includes(key))
		),
		...(node.required === undefined
			? {}
			: { required: node.required.filter((key) => !skip.includes(key)) })
	};
}

/** The schema of `employment_profile.facts`: the `facts` node's keys beside `employment_statutory_facts`. */
export function profileFactsSchema(schema: JsonSchemaNode | null): JsonSchema | null {
	if (schema == null) return null;
	const facts: JsonSchemaNode = schema.properties?.facts ?? { type: 'object' };
	const standings = schema.properties?.employment_statutory_facts;
	return formSchema({
		...facts,
		properties:
			standings === undefined
				? (facts.properties ?? {})
				: { ...facts.properties, employment_statutory_facts: standings }
	});
}
