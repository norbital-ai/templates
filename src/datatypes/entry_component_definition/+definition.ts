import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { componentCapSchema } from '../component_definition/+definition.js';

/** The unit, evidence and cap rules for an amount supplied through a family entry. */
export const entryComponentDefinitionValueSchema = Schema.Struct({
	source: Schema.Literal('ENTRY'),
	unit: Schema.Literals(['MONEY', 'DAYS', 'HOURS']),
	evidence: Schema.Literals(['NONE', 'OPTIONAL', 'REQUIRED']),
	cap: Schema.NullOr(componentCapSchema),
	settlement: Schema.Literals(['PAYROLL', 'COMPANY_DIRECT'])
});

export type EntryComponentDefinition = Schema.Schema.Type<
	typeof entryComponentDefinitionValueSchema
>;

/** Strict standard view: a key the arm does not declare is refused rather than stripped. */
export const entryComponentDefinitionSchema = Schema.toStandardSchemaV1(
	entryComponentDefinitionValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'entry_component_definition',
	description:
		'How a component a person raises an event against produces its amount: the unit it is stated in, whether it demands evidence, the layered entitlement cap it is bounded by, and whether it settles through payroll or is paid directly by the company.',
	schema: entryComponentDefinitionSchema
});
