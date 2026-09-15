import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';
import { entitlementValueSchema } from '../entitlement/+definition.js';

/**
 * One band of a catalogue row.
 *
 * A catalogue prices its entries through ordered bands over the entry context: the first band whose
 * `when` holds governs. The band states the amount the line settles (`amount`) and the
 * entitlement ceiling (`limit`, nullable). A catalogue with no bands settles the entry's own
 * amount unchanged; which schemes charge the line is the scheme's own declaration.
 *
 * Every expression is compiled against the `entry` context at write time, so a misspelt member or
 * a string where money belongs is refused before a payroll reads it.
 */
export const catalogueBandValueSchema = Schema.Struct({
	/** CEL over the entry context; `''` is every entry. */
	when: Schema.String,
	/** Money over the entry context; a plain figure is a valid expression. */
	amount: Schema.String.check(Schema.isMinLength(1)),
	limit: Schema.NullOr(entitlementValueSchema)
});

export type CatalogueBand = Schema.Schema.Type<typeof catalogueBandValueSchema>;

export const catalogueBandsValueSchema = Schema.Array(catalogueBandValueSchema).check(
	Schema.makeFilter((bands) => {
		for (const band of bands) {
			const when = compileExpression({ expression: band.when, site: 'entry', type: 'boolean' });
			if (when != null) return when;
			const amount = compileExpression({ expression: band.amount, site: 'entry', type: 'money' });
			if (amount != null) return amount;
		}
		return true;
	})
);

export default defineCustomType({
	name: 'catalogue_band',
	description:
		'One band of a catalogue row: its condition over the entry context, the amount it settles and its entitlement ceiling. Bands are read in order; the first condition that holds governs.',
	schema: Schema.toStandardSchemaV1(catalogueBandsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
