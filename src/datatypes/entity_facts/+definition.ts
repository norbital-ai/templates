import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The entity's own facts: the values a version's declared fact keys are read from.
 *
 * An entity fact is a recorded truth about the employer — its sector, whether it consents to
 * overtime, whether it meets an establishment test — that a rule may name as
 * `person.company.facts.<key>`. Keys and types are declared by the settings version; the entity
 * carries only the values.
 */
const entityFactsValueSchema = Schema.Record(
	Schema.String,
	Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])
);

export default defineCustomType({
	name: 'entity_facts',
	description:
		'The entity’s recorded facts, keyed by the names the settings version declares: sector, overtime consent, establishment tests.',
	schema: Schema.toStandardSchemaV1(entityFactsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
