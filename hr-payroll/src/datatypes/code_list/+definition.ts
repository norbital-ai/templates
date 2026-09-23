import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * A list of codes: a class's `counts_toward` (the scheme codes whose base it enters, a part
 * named with a dot — `CPF.ADDITIONAL`) and a scheme's `parts`. Codes are the catalogue's own
 * grammar, upper-case with digits and underscores; the version seal checks that a scheme named
 * here exists in the same version, the type only checks the spelling.
 */
const codeSchema = Schema.String.check(Schema.isPattern(/^[A-Z0-9_]+(?:\.[A-Z0-9_]+)?$/));
export const codeListValueSchema = Schema.Array(codeSchema);

export default defineCustomType({
	name: 'code_list',
	description:
		'A list of codes: the schemes a class counts toward (a part after a dot), or the parts a scheme declares.',
	schema: Schema.toStandardSchemaV1(codeListValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
