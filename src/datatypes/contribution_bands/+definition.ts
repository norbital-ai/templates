import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';

/**
 * The bands of one statutory scheme (RFC 0001 §8): a ladder of expressions.
 *
 * Each band states the condition it governs under (`when`, CEL over the scheme context), and the
 * employee and employer money it charges there. The engine walks the bands in declaration order and
 * the first whose `when` holds governs; the terminal rung's condition is what makes high wages
 * chargeable (`base > 20000.0`), so a ladder that covers nobody at a wage stops the run rather than
 * quietly reusing the last rung (decision E24).
 *
 * A `PERCENT` award is `base * 11.0 / 100.0`; a `FIXED` award is the published figure; a
 * progressive step is `constant + (base - from) * rate / 100.0` under its own range. Every band
 * is compiled against the `scheme` context at write time, so a misspelt member or a string where
 * money belongs is refused before any payroll reads it.
 */

const cel = Schema.String.check(Schema.isMinLength(1));

export const contributionBandSchema = Schema.Struct({
	/** CEL over the scheme context: the range and any person condition this rung governs. */
	when: cel,
	/** CEL returning the employee share for a matching band. */
	employee: cel,
	/** CEL returning the employer share for a matching band. */
	employer: cel
});
export type ContributionBand = Schema.Schema.Type<typeof contributionBandSchema>;

export const contributionBandsValueSchema = Schema.Array(contributionBandSchema).check(
	Schema.makeFilter((bands) => {
		for (const band of bands) {
			const when = compileExpression({ expression: band.when, site: 'scheme', type: 'boolean' });
			if (when != null) return when;
			const employee = compileExpression({
				expression: band.employee,
				site: 'scheme',
				type: 'number'
			});
			if (employee != null) return employee;
			const employer = compileExpression({
				expression: band.employer,
				site: 'scheme',
				type: 'number'
			});
			if (employer != null) return employer;
		}
		return true;
	})
);

export default defineCustomType({
	name: 'contribution_bands',
	description:
		'The bands of one statutory contribution as expressions: each the condition it governs under and the employee and employer money it charges. Bands are read in order; the first condition that holds governs. A floor is the first band, the terminal rung an open-ended condition; no expression may quietly reuse another rung.',
	schema: Schema.toStandardSchemaV1(contributionBandsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
