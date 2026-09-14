import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import {
	nightPremiumValueSchema,
	overtimeCoverageValueSchema
} from '../../lib/payroll/work-rules-values.js';
import { compileExpression } from '../../lib/expressions/compile.js';
import { prorationBasisValueSchema } from '../proration_basis/+definition.js';

/**
 * The work rules of one settings version (RFC 0001 §4–§6).
 *
 * Work is a line-item producer, not a catalogue family: these rules price schedule and
 * attendance into BASIC, the OVERTIME classes and INCENTIVE, and they state the ceilings that
 * schedules must respect. Every attribute whose value is a decision about money is a CEL string
 * compiled at write time against the `work_day` context (`lib/expressions`); the fields that are
 * structured data stay typed.
 *
 * - `proration` returns the month's denominator (calendar days, working days, or a fixed factor).
 * - `rates.ordinary` picks the day/hour divisor, first row whose `when` holds.
 * - `rates.bands` prices the day, in order; each band consumes hours and may funnel the slice
 *   above a named limit to another line at its own award (the incentive).
 * - `limits` are enforced when schedules are written; their evaluated values are readable in CEL
 *   as `limits.<key>`.
 * - `breaks` state what the law owes; the shift's `break_minutes` is what it grants.
 */

const cel = Schema.String.check(Schema.isMinLength(1));

export const workLimitValueSchema = Schema.Struct({
	/** Read in CEL as `limits.<key>`. */
	key: Schema.String.check(Schema.isMinLength(1)),
	period: Schema.Literals(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']),
	measure: Schema.Literals(['TOTAL_WORK_HOURS', 'OVERTIME_HOURS', 'NORMAL_HOURS', 'SPREAD_HOURS']),
	max_hours: Schema.Finite.check(Schema.isGreaterThan(0)),
	/**
	 * How `max_hours` is measured: a CLOCK span evaluates against the shift by subtracting its
	 * break, so a twelve-hour day less a one-hour break is 11 net worked hours. WORKED states the
	 * figure directly.
	 */
	unit: Schema.Literals(['WORKED_HOURS', 'CLOCK_HOURS']),
	authority: Schema.optionalKey(Schema.String)
});
export type WorkLimit = Schema.Schema.Type<typeof workLimitValueSchema>;

export const workBreakValueSchema = Schema.Struct({
	/** CEL over the `work_day` context: the consecutive-hours or OT-length condition. */
	when: cel,
	/** Minutes owed once `when` holds; a CEL string where the law's duration is a formula. */
	owed_minutes: Schema.Union([Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)), cel]),
	counts_as_worked_time: Schema.NullOr(Schema.Boolean)
});
export type WorkBreak = Schema.Schema.Type<typeof workBreakValueSchema>;

export const ordinaryRateBandValueSchema = Schema.Struct({
	/** CEL over the `person` context; empty is everyone. */
	when: Schema.String,
	unit: Schema.Literals(['DAY', 'HOUR']),
	divisor: Schema.Union([
		Schema.Finite.check(Schema.isGreaterThan(0)),
		Schema.Literal('WORKING_DAYS')
	])
});
export type OrdinaryRateBand = Schema.Schema.Type<typeof ordinaryRateBandValueSchema>;

/** One scheme a work line opts into, with the effect it has on that scheme's base. */
export const statutoryOptInValueSchema = Schema.Struct({
	contribution_id: Schema.String.check(Schema.isUUID()),
	effect: Schema.Literals(['INCLUDE', 'REDUCE'])
});
export type StatutoryOptIn = Schema.Schema.Type<typeof statutoryOptInValueSchema>;
export const statutoryOptInSchema = Schema.toStandardSchemaV1(statutoryOptInValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export const workRateBandValueSchema = Schema.Struct({
	/** The label printed on the payslip line, e.g. the OT class "OT-1.5X". */
	label: Schema.String.check(Schema.isMinLength(1)),
	/** The line the band emits: OVERTIME, INCENTIVE, NIGHT, ABSENCE. */
	line: Schema.String.check(Schema.isMinLength(1)),
	/** CEL over the `work_day` context. */
	when: cel,
	/** CEL: the slice of the day this band consumes. */
	take: cel,
	/** CEL: the money those hours earn. */
	price: cel,
	/**
	 * The funnel: the portion of this band's slice above `above` is routed to `line` at the same
	 * price, so an incentive inherits the award of the band the hours came from.
	 */
	funnel: Schema.optionalKey(
		Schema.Struct({
			/** CEL returning hours, typically `limits.<key>`. */
			above: cel,
			line: Schema.String.check(Schema.isMinLength(1))
		})
	),
	statutory_opt_ins: Schema.Array(statutoryOptInValueSchema)
});
export type WorkRateBand = Schema.Schema.Type<typeof workRateBandValueSchema>;

/** One CEL fault, named by the row it rides, or null when the expression compiles to its type. */
const faultIn = (
	expression: string,
	site: 'person' | 'work_day',
	type: 'boolean' | 'number',
	label: string
): string | null => {
	const fault = compileExpression({ expression, site, type });
	return fault == null ? null : `${label}: ${fault}`;
};

/**
 * Every expression a work-rules row carries is compiled at write time against the context it will
 * be evaluated in (RFC 0001 §7): bands and breaks over `work_day`, the ordinary-rate rows over
 * `person`. A misspelt member or a string where hours belong is refused when the version is
 * written, not when a payroll prices the month it governs.
 */
export const workRulesValueSchema = Schema.Struct({
	/**
	 * How a partial month is prorated. Typed, not CEL: the FIXED_DAYS arm's instalment share and
	 * its cap are arithmetic the engine must store beside its result (`payslip_proration.basis`),
	 * and a scalar expression could state the denominator but not the unit its numerator counts in.
	 */
	proration: prorationBasisValueSchema,
	/**
	 * The engine-priced lines that are not bands — BASIC salary, unexplained ABSENCE and the
	 * NIGHT premium — and the schemes each opts into. A band carries its own opt-ins; these three
	 * are produced by the engine and state theirs here. Silence means no statutory effect.
	 */
	engine_lines: Schema.Struct({
		salary: Schema.Struct({ statutory_opt_ins: Schema.Array(statutoryOptInValueSchema) }),
		absence: Schema.Struct({ statutory_opt_ins: Schema.Array(statutoryOptInValueSchema) }),
		night: Schema.Struct({ statutory_opt_ins: Schema.Array(statutoryOptInValueSchema) })
	}),
	rates: Schema.Struct({
		ordinary: Schema.Array(ordinaryRateBandValueSchema),
		bands: Schema.Array(workRateBandValueSchema)
	}),
	limits: Schema.Array(workLimitValueSchema),
	breaks: Schema.Array(workBreakValueSchema),
	weekly_rest_rule: Schema.Struct({
		max_consecutive_work_days: Schema.Int.check(Schema.isGreaterThan(0)),
		discharged_by: Schema.Literals(['REST', 'REST_OR_OFF'])
	}),
	/** Who the overtime ladder covers — wage ceiling, category basis and exemptions. */
	coverage: Schema.NullOr(overtimeCoverageValueSchema),
	/** The instrument the rules transcribe; quoted by refusals. */
	authority: Schema.optionalKey(Schema.String),
	night_premium: Schema.optionalKey(Schema.NullOr(nightPremiumValueSchema)),
	holiday_rest_precedence: Schema.Literals(['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE'])
}).check(
	Schema.makeFilter((rules) => {
		for (const row of rules.rates.ordinary) {
			const fault = faultIn(row.when, 'person', 'boolean', 'Ordinary rate row');
			if (fault != null) return fault;
		}
		for (const band of rules.rates.bands) {
			const when = faultIn(band.when, 'work_day', 'boolean', `Band ${band.label}`);
			if (when != null) return when;
			const take = faultIn(band.take, 'work_day', 'number', `Band ${band.label} take`);
			if (take != null) return take;
			const price = faultIn(band.price, 'work_day', 'number', `Band ${band.label} price`);
			if (price != null) return price;
			if (band.funnel != null) {
				const above = faultIn(band.funnel.above, 'work_day', 'number', `Band ${band.label} funnel`);
				if (above != null) return above;
			}
		}
		for (const [index, brk] of rules.breaks.entries()) {
			const when = faultIn(brk.when, 'work_day', 'boolean', `Break ${index + 1}`);
			if (when != null) return when;
			if (typeof brk.owed_minutes === 'string') {
				const owed = faultIn(
					brk.owed_minutes,
					'work_day',
					'number',
					`Break ${index + 1} owed minutes`
				);
				if (owed != null) return owed;
			}
		}
		return true;
	})
);
export type WorkRules = Schema.Schema.Type<typeof workRulesValueSchema>;

export default defineCustomType({
	name: 'work_rules',
	description:
		'One version’s work rules: proration and ordinary-rate CEL, the ordered rate bands that price a day (including the incentive funnel), the limits schedules must respect, the breaks the law owes, the weekly rest rule, the night premium and holiday/rest precedence.',
	schema: Schema.toStandardSchemaV1(workRulesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
