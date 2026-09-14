import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';
import { statutoryOptInValueSchema } from '../work_rules/+definition.js';
import { entitlementValueSchema } from '../entitlement/+definition.js';

/**
 * One band of a catalogue row (RFC 0001 §4, §9).
 *
 * A catalogue prices its entries through ordered bands over the entry context: the first band whose
 * `when` holds governs. The band states the amount the line settles (`amount`), the entitlement
 * ceiling (`limit`, nullable), and the statutory schemes the line opts into
 * (`statutory_opt_ins`) — silence means no effect. A catalogue with no bands settles the entry's
 * own amount unchanged.
 *
 * Every expression is compiled against the `entry` context at write time, so a misspelt member or
 * a string where money belongs is refused before a payroll reads it.
 */
export const catalogueBandValueSchema = Schema.Struct({
	/** CEL over the entry context; `''` is every entry. */
	when: Schema.String,
	/** A figure, or a CEL expression over the entry context producing one. */
	amount: Schema.Union([Schema.Finite, Schema.String.check(Schema.isMinLength(1))]),
	limit: Schema.NullOr(entitlementValueSchema),
	statutory_opt_ins: Schema.Array(statutoryOptInValueSchema)
});

export type CatalogueBand = Schema.Schema.Type<typeof catalogueBandValueSchema>;

export const catalogueBandsValueSchema = Schema.Array(catalogueBandValueSchema).check(
	Schema.makeFilter((bands) => {
		for (const band of bands) {
			const when = compileExpression({ expression: band.when, site: 'entry', type: 'boolean' });
			if (when != null) return when;
			if (typeof band.amount === 'string') {
				const amount = compileExpression({
					expression: band.amount,
					site: 'entry',
					type: 'number'
				});
				if (amount != null) return amount;
			}
		}
		return true;
	})
);

export default defineCustomType({
	name: 'catalogue_band',
	description:
		'One band of a catalogue row: its condition over the entry context, the amount it settles, its entitlement ceiling and the statutory schemes the line opts into. Bands are read in order; the first condition that holds governs.',
	schema: Schema.toStandardSchemaV1(catalogueBandsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
