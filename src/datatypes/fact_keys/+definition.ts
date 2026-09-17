import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * The fact keys one row declares.
 *
 * A key is a choice or an entity fact the row reads, and its type says what a value may be:
 * a scheme's employment elections (SHG opt-out, a full-rate SPR standing, a PCB disabled or zakat
 * declaration, union membership, a voluntary contribution rate, a withholding-table choice, a
 * PTKP status) and a version's entity facts (sector, overtime consent, establishment tests). They
 * differ only in name and type, so the declaring row carries the keys it reads; the engine keeps
 * no enum, and a write refuses a mention the row does not declare.
 */
export const factKeySchema = Schema.Struct({
	key: Schema.String.check(Schema.isMinLength(1)),
	type: Schema.Literals(['boolean', 'number', 'string'])
});

export const factKeysValueSchema = Schema.Array(factKeySchema);

export default defineCustomType({
	name: 'fact_keys',
	description: 'The fact keys a row declares: each key and the type of value it expects.',
	schema: Schema.toStandardSchemaV1(factKeysValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
