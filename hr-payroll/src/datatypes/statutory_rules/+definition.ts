import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { RoundingMethodSchema } from '../../collections/payroll_runs/lib/rounding.js';
import { compileExpression } from '../../lib/expressions/compile.js';

/**
 * The rules of one statutory scheme (RFC 0001 §8): the arithmetic that wraps its band ladder.
 *
 * Expressions carry what the law writes as a formula — the personal reliefs that reduce chargeable
 * income, the transform that brackets or grades the chargeable base, and the household factor that
 * multiplies the employee share for dependants. The typing is CEL over the scheme context, checked
 * at write time; an empty string is a real answer meaning "nothing changes".
 *
 * The remainder stays structured data because it is a decision, not an amount: how the shares
 * round, when withholding is suppressed, whether the bands are a period table rather than an
 * annual scale, whether a payment's extra remuneration is chargeable, and the annual cap and pool
 * that apply when this scheme's employee share relieves another.
 */
export const statutoryRulesValueSchema = Schema.Struct({
	/**
	 * CEL returning the annual relief this scheme grants against chargeable income; `''` is none.
	 * Personal, spouse and dependant amounts are arithmetic over `person`, so a statute that states
	 * them as three figures and one that states a total are the same row.
	 */
	relief: Schema.String,
	/**
	 * CEL returning the chargeable base after the scheme's own transform — a wage-bracket ladder
	 * (`bracket`), a published grade table (`ladder`), a minimum-wage floor, a cap. `''` uses the
	 * assembled base exactly.
	 */
	base_transform: Schema.String,
	/**
	 * CEL returning the employee share after the household factor a scheme charges per dependant;
	 * `''` leaves the share as the band awarded it. The result is rounded to the cent, because a
	 * per-head premium is billed per head, not as a fraction of one.
	 */
	share_for_dependants: Schema.String,
	/** Applied in order; empty means the share is stated exactly (a table of published figures). */
	rounding: Schema.Array(RoundingMethodSchema),
	/** Suppress the employee share below this; the employer leg is never suppressed. */
	no_withholding_below: Schema.Number,
	/**
	 * Whether the bands are a table for the payroll period itself. When false the scheme is an
	 * annual scale: the engine projects, relieves, scales and spreads. This is the explicit form of
	 * what used to be inferred from the band shapes.
	 */
	use_period_table: Schema.Boolean,
	/** Whether a `SPECIAL` treatment cell may post into this scheme's additional-remuneration channel. */
	additional_remuneration_channel: Schema.Boolean,
	/** Annual ceiling on this scheme's employee share when it relieves another; null is no cap. */
	employee_share_annual_cap: Schema.NullOr(Schema.Number),
	/** Schemes in one pool share the tightest cap they name. */
	shared_cap_group: Schema.NullOr(Schema.String),
	/** Whether the relief includes the months still to run, not just the year so far. */
	project_relief_annually: Schema.Boolean,
	/** Round the paired total, floor the employee share, give the remainder to the employer. */
	total_rounded_employee_floored: Schema.Boolean
});
export type StatutoryRules = Schema.Schema.Type<typeof statutoryRulesValueSchema>;

const numberCel = (expression: string): string | null =>
	expression.trim() === ''
		? null
		: compileExpression({ expression, site: 'scheme', type: 'number' });

export const statutoryRulesSchema = Schema.toStandardSchemaV1(statutoryRulesValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
}).check(
	Schema.makeFilter((rules) => {
		for (const expression of [rules.relief, rules.base_transform, rules.share_for_dependants]) {
			const error = numberCel(expression);
			if (error != null) return error;
		}
		return true;
	})
);

export default defineCustomType({
	name: 'statutory_rules',
	description:
		'The arithmetic around one statutory scheme’s bands: relief, base transform and dependant share as expressions over the scheme context, with the typed remainder — rounding, withholding threshold, period table, additional-remuneration channel, relief caps and projection.',
	schema: statutoryRulesSchema
});
