import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { nightPremiumValueSchema } from '../../lib/payroll/work-rules-values.js';
import { compileExpression } from '../../lib/expressions/compile.js';
import type { ExpressionSite, ExpressionType } from '../../lib/expressions/contexts.js';
import { openKeyMentions } from '../../lib/expressions/contexts.js';
import { prorationBasisValueSchema } from '../proration_basis/+definition.js';
import { wagesValueSchema } from '../wages/+definition.js';

/**
 * The work rules of one settings version.
 *
 * Work is a line-item producer, not a catalogue family: these rules price schedule and
 * attendance into BASIC, the OVERTIME classes and INCENTIVE, and they state the ceilings that
 * schedules must respect. Every attribute whose value is a decision about money is an expression
 * compiled at write time against the context it will be evaluated in (`lib/expressions`); the
 * fields that are structured data stay typed. Every expression field is named for what it returns:
 * `_when` is a boolean, `_hours`, `_minutes` and `_days` are that unit, and `_amount` is money.
 *
 * - `proration` returns the month's denominator (calendar days, working days, or a fixed factor).
 * - `ordinary_divisor_days` is the days-per-month divisor of the ordinary rate, over the person.
 * - `overtime_when` says who the overtime ladder covers, over the person; empty is everyone.
 * - `bands` price the day, in order; each band consumes hours, and the incentive hours that fall
 *   in its slice are paid on its INCENTIVE line at its own award.
 * - `limits` are applied when schedules are written — an overtime limit splits planned overtime,
 *   a shift's own hours or spread-over above a limit are refused; an hours limit's evaluated value is
 *   readable in expressions as `limits.<key>`, and the consecutive-work-days limit is the weekly
 *   rest rule the roster gate judges.
 * - `breaks` state what the law owes; the shift's `break_minutes` is what it grants.
 * - `wages` is the minimum wage by region and who it covers.
 */

const cel = Schema.String.check(Schema.isMinLength(1));

const workLimitValueSchema = Schema.Struct({
	/** Read in expressions as `limits.<key>`. */
	key: Schema.String.check(Schema.isMinLength(1)),
	period: Schema.Literals(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']),
	/**
	 * OVERTIME_HOURS is regulated overtime — ordinary and off-day hours beyond the normal day,
	 * the count the monthly incentive limit reads; ALL_OVERTIME_HOURS also counts rest-day and holiday
	 * hours beyond the normal day, the MOM reading of SG's 72-hour month, and is reported only.
	 */
	measure: Schema.Literals([
		'TOTAL_WORK_HOURS',
		'OVERTIME_HOURS',
		'ALL_OVERTIME_HOURS',
		'NORMAL_HOURS',
		'SPREAD_HOURS'
	]),
	max_hours: Schema.Finite.check(Schema.isGreaterThan(0)),
	/**
	 * How `max_hours` is measured: a CLOCK span evaluates against the shift by subtracting its
	 * break, so a twelve-hour day less a one-hour break is 11 net worked hours. WORKED states the
	 * figure directly.
	 */
	unit: Schema.Literals(['WORKED_HOURS', 'CLOCK_HOURS']),
	/**
	 * Who the limit governs, over the person; absent or empty is everyone. A sector's own yearly
	 * ceiling (VN art.107(3): 300 hours) or a consented variant (TW §32(2): 54 a month) is a limit
	 * with a predicate, judged per person at the roster gate and at payroll; a pattern, which
	 * belongs to no one person, is judged against the unconditional limits only.
	 */
	when: Schema.optionalKey(Schema.String),
	/**
	 * Boolean over the work day: a day it holds on adds every hour worked on it to this limit's
	 * count, not only the hours beyond its normal day (TW 勞基法 §36(3): hours worked on a 休息日
	 * count toward the §32(2) overtime totals). An emergency day stays outside every ceiling.
	 * Read by the monthly, quarterly and yearly ceiling report only; absent is none.
	 */
	counts_day_when: Schema.optionalKey(Schema.String),
	/**
	 * Boolean over the work day: a day it holds on adds the hours worked beyond its normal day to
	 * this limit's count, where the measure left them out (TW 勞基法 §32(2) as read by 勞委會
	 * (89)台勞動二字第0041535號: hours past eight on a 例假 or a §37 休假日 are extended hours).
	 * `counts_day_when` wins on a day both hold. Read by the ceiling report only; absent is none.
	 */
	counts_beyond_normal_when: Schema.optionalKey(Schema.String),
	authority: Schema.optionalKey(Schema.String)
});
export type WorkHoursLimit = Schema.Schema.Type<typeof workLimitValueSchema>;

/**
 * The weekly rest rule as a limit: at most `max_days` consecutive worked days, the run broken by
 * a rest day (REST) or by a rest day or an unrostered day (REST_OR_OFF). Judged at the roster
 * gate, not read as `limits.<key>` by a band.
 */
const workRestLimitValueSchema = Schema.Struct({
	key: Schema.String.check(Schema.isMinLength(1)),
	measure: Schema.Literal('CONSECUTIVE_WORK_DAYS'),
	max_days: Schema.Int.check(Schema.isGreaterThan(0)),
	discharged_by: Schema.Literals(['REST', 'REST_OR_OFF']),
	/**
	 * Leave codes whose approved days suspend the rule (MY s.59(1A): a rest day is not owed
	 * while on maternity, sick or disablement leave): a day under such leave breaks the run
	 * of worked days the way a rest day does. Absent is none.
	 */
	suspended_by_leave: Schema.optionalKey(Schema.Array(Schema.String)),
	/**
	 * The averaging arm: a run longer than the ceiling stands where the `days`-day span ending
	 * on its last day still holds `rest_days` rest days (VN art.111(1): at least four a month
	 * where the work cannot be weekly). Absent is a strict weekly ceiling.
	 */
	average: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				days: Schema.Int.check(Schema.isGreaterThan(0)),
				rest_days: Schema.Int.check(Schema.isGreaterThan(0)),
				/** Who the arm applies to, over the person (an entity fact for the work cycles that cannot rest weekly); absent is everyone. */
				when: Schema.optionalKey(Schema.String)
			})
		)
	),
	when: Schema.optionalKey(Schema.String),
	authority: Schema.optionalKey(Schema.String)
});
export type WorkRestLimit = Schema.Schema.Type<typeof workRestLimitValueSchema>;
export type WorkLimit = WorkHoursLimit | WorkRestLimit;
export const isRestLimit = (limit: WorkLimit): limit is WorkRestLimit =>
	limit.measure === 'CONSECUTIVE_WORK_DAYS';

const workBreakValueSchema = Schema.Struct({
	/** Boolean over the work day: the consecutive-hours or OT-length condition. */
	when: cel,
	/** Minutes over the work day, owed once `when` holds; a plain figure is a valid expression. */
	owed_minutes: cel,
	counts_as_worked_time: Schema.NullOr(Schema.Boolean)
});
export type WorkBreak = Schema.Schema.Type<typeof workBreakValueSchema>;

const workRateBandValueSchema = Schema.Struct({
	/** The label printed on the payslip line, e.g. the OT class "OT-1.5X". */
	label: Schema.String.check(Schema.isMinLength(1)),
	/** Boolean over the work day. */
	when: cel,
	/** Hours over the work day: the slice of the day this band consumes. */
	take_hours: cel,
	/** Money over the work day: what the whole slice earns; `hours` is the slice actually consumed. */
	price_amount: cel,
	/**
	 * Inert: nothing reads it. It once named the day limit above which planned OT became incentive;
	 * every overtime limit now splits (`splitsOvertime`). Kept, and still compiled, only because
	 * sealed versions (MY-nihon, VN) store it.
	 */
	funnel_above_hours: Schema.optionalKey(cel)
});
export type WorkRateBand = Schema.Schema.Type<typeof workRateBandValueSchema>;

/** One expression fault, named by the row it rides, or null when it compiles to its type. */
const faultIn = (
	expression: string,
	site: ExpressionSite,
	type: ExpressionType,
	label: string
): string | null => {
	const fault = compileExpression({ expression, site, type });
	return fault == null ? null : `${label}: ${fault}`;
};

/**
 * Every expression a work-rules row carries is compiled at write time against the context it will
 * be evaluated in: bands and breaks over `work_day`, the divisor and the overtime
 * predicate over `person`. A misspelt member or a string where hours belong is refused when the
 * version is written, not when a payroll prices the month it governs.
 */
export const workRulesValueSchema = Schema.Struct({
	/**
	 * How a partial month is prorated. Typed, not an expression: the FIXED_DAYS arm's instalment
	 * share and its cap are arithmetic the engine must store beside its result
	 * (`payslip_proration.basis`), and a scalar expression could state the denominator but not the
	 * unit its numerator counts in.
	 */
	proration: prorationBasisValueSchema,
	/**
	 * Arms over the person, in order, each naming its own basis; the first whose `when` holds
	 * replaces `proration` for that person (PH Handbook ch.2: a monthly-paid employee's part month
	 * and absence on the 365 factor, 30.4167 a month, while the daily-paid keep 261 or 313).
	 * Absent or empty is `proration` for everyone.
	 */
	proration_by: Schema.optionalKey(
		Schema.Array(Schema.Struct({ when: cel, basis: prorationBasisValueSchema }))
	),
	/**
	 * Days over the person: the statutory divisor the monthly wage is spread over to price one
	 * ordinary day, e.g. `26.0` (Malaysia), `period.working_days` (Vietnam), or a ternary over the
	 * week shape (the Philippines). The hour is that day over the contract's normal daily hours.
	 */
	ordinary_divisor_days: cel,
	/**
	 * Days over the person a daily wage is taken to a month by before `ordinary_divisor_days`
	 * prices its hour (ID PP 35/2021 art.33(1)(b): × 21 on a five-day week, × 25 on a six-day
	 * one, then 1/173). Absent or empty is the day over its normal hours.
	 */
	daily_month_days: Schema.optionalKey(Schema.String),
	/** A statutory ordinary rate taken from approved dated wage history instead of the current contract. */
	ordinary_rate_reference: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				reference: Schema.Literals(['PREVIOUS_WAGE_PERIOD', 'LATEST_DUE_MONTH']),
				pay_frequencies: Schema.Array(
					Schema.Literals(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'])
				).check(Schema.isMinLength(1)),
				authority: Schema.String.check(
					Schema.makeFilter(
						(value) => value.trim() !== '' || 'Ordinary-rate reference authority is required.'
					)
				)
			})
		)
	),
	/** Separate valuation of unused leave. Missing rules stop an encashment; overtime rates are never a fallback. */
	encashment: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				reference: Schema.Literals(['EVENT_DATE', 'PREVIOUS_MONTH', 'PREVIOUS_DAY_OR_MONTH']),
				day_amount: cel,
				pay_frequencies: Schema.Array(
					Schema.Literals(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'])
				).check(Schema.isMinLength(1)),
				include_allowances: Schema.Array(Schema.String),
				exclude_allowances: Schema.Array(Schema.String),
				preserve_year_end_rate: Schema.Boolean,
				/**
				 * Entity facts (`company.facts.<key>`) the valuation cannot proceed without, where the law
				 * defers the basis to the contract, company regulation or collective agreement (ID UU
				 * 13/2003 art.79(4) as amended). Required only when leave is cashed out.
				 */
				required_facts: Schema.optionalKey(Schema.Array(Schema.String)),
				authority: Schema.String.check(
					Schema.makeFilter(
						(value) => value.trim() !== '' || 'Leave cash-out authority is required.'
					)
				)
			})
		)
	),
	/**
	 * Allowance codes outside the gross rate of pay, read at the work day as
	 * `person.terms.gross_monthly` (SG EA s.2: travelling, food or housing allowances). Absent is none.
	 */
	gross_excluded_allowances: Schema.optionalKey(Schema.Array(Schema.String)),
	/** Boolean over the person: who the overtime ladder covers. Empty is everyone. */
	overtime_when: Schema.String,
	/**
	 * The statute's normal day in hours, over the person; absent or empty is the shift's own
	 * length. A shift longer than it is a normal day plus overtime (MY s.60A(1): 8, or 9 under
	 * the proviso's 45-hour week; SG s.38(1): 9 on a week of five days or fewer, else 8; PH
	 * art.83: 8). A rostered shift shorter than it is that day's normal day — overtime is the
	 * hours beyond the normal hours of work, and a short day's normal hours are its own (ID PP
	 * 35/2021 art.31(2)(b): a six-day worker's five-hour Saturday prices its holiday tiers on five).
	 */
	normal_hours: Schema.optionalKey(Schema.String),
	/**
	 * The hours a week a full-time monthly-rated hour is built on, whatever the contract's week, where the
	 * statute fixes it (SG EA Fourth Schedule: 12 × monthly ÷ (52 × 44)); a cap on other wage
	 * bases' week. Absent where the hour is the day over the daily normal hours (MY s.60I(1)(b)).
	 */
	rate_week_hours: Schema.optionalKey(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0)))),
	bands: Schema.Array(workRateBandValueSchema),
	limits: Schema.Array(Schema.Union([workLimitValueSchema, workRestLimitValueSchema])),
	breaks: Schema.Array(workBreakValueSchema),
	/** Region → monthly minimum wage in the version's currency, and who the order covers. */
	wages: wagesValueSchema,
	/** The instrument the rules transcribe; quoted by refusals. */
	authority: Schema.optionalKey(Schema.String),
	night_premium: Schema.optionalKey(Schema.NullOr(nightPremiumValueSchema)),
	/**
	 * The balance of hours a worker took as time off instead of overtime pay, where the law lets
	 * them (TW 勞基法 §32-1): each elected hour is credited at what its band would have paid, hours
	 * taken as `leave_code` leave use the oldest credit first, and what is left is paid at the
	 * credited value once it expires or the contract ends. A credit expires `expiry_months` (a
	 * number over the person; 0 where none was agreed) after its day, and never later than the last
	 * day of the `year_leave_code` leave's year. Absent: bands honouring the election leave the
	 * hours unpriced and the run only warns.
	 */
	time_off_in_lieu: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				leave_code: Schema.String.check(Schema.isMinLength(1)),
				year_leave_code: Schema.String.check(Schema.isMinLength(1)),
				expiry_months: cel,
				authority: Schema.String
			})
		)
	),
	holiday_rest_precedence: Schema.Literals(['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE'])
}).check(
	Schema.makeFilter((rules) => {
		if (
			rules.encashment?.include_allowances.some((code) =>
				rules.encashment?.exclude_allowances.includes(code)
			)
		)
			return 'Leave cash-out: an allowance cannot be both included and excluded.';
		const limitKeys = new Set(rules.limits.map((limit) => limit.key));
		const expressions = [
			rules.ordinary_divisor_days,
			rules.overtime_when,
			...rules.bands.flatMap((band) => [
				band.when,
				band.take_hours,
				band.price_amount,
				band.funnel_above_hours ?? ''
			]),
			...rules.breaks.flatMap((brk) => [brk.when, brk.owed_minutes])
		];
		// `limits.<key>` is an open prefix: the key is a code of this version, and the version is
		// this row, so a key no limit declares is refused here rather than read as zero at payroll.
		for (const expression of expressions)
			for (const key of openKeyMentions(expression, 'limits'))
				if (!limitKeys.has(key))
					return `Limits: the expression names limits.${key}, but this version declares no such limit.`;
		const faults = [
			rules.encashment == null
				? null
				: faultIn(rules.encashment.day_amount, 'person', 'money', 'Leave cash-out daily pay'),
			faultIn(rules.ordinary_divisor_days, 'person', 'days', 'Ordinary divisor'),
			(rules.daily_month_days ?? '').trim() === ''
				? null
				: faultIn(rules.daily_month_days ?? '', 'person', 'days', 'Daily wage month'),
			faultIn(rules.overtime_when, 'person', 'boolean', 'Overtime eligibility'),
			...rules.bands.flatMap((band) => [
				faultIn(band.when, 'work_day', 'boolean', `Band ${band.label}`),
				faultIn(band.take_hours, 'work_day', 'hours', `Band ${band.label} take`),
				faultIn(band.price_amount, 'work_day', 'money', `Band ${band.label} price`),
				band.funnel_above_hours == null
					? null
					: faultIn(band.funnel_above_hours, 'work_day', 'hours', `Band ${band.label} funnel`)
			]),
			...rules.breaks.flatMap((brk, index) => [
				faultIn(brk.when, 'rest_break', 'boolean', `Break ${index + 1}`),
				faultIn(brk.owed_minutes, 'rest_break', 'minutes', `Break ${index + 1} owed minutes`)
			]),
			(rules.normal_hours ?? '').trim() === ''
				? null
				: faultIn(rules.normal_hours ?? '', 'person', 'hours', 'Normal hours'),
			...rules.limits.map((limit) =>
				(limit.when ?? '').trim() === ''
					? null
					: faultIn(limit.when ?? '', 'person', 'boolean', `Limit ${limit.key}`)
			),
			...rules.limits.map((limit) =>
				!('counts_day_when' in limit) || (limit.counts_day_when ?? '').trim() === ''
					? null
					: faultIn(limit.counts_day_when ?? '', 'work_day', 'boolean', `Limit ${limit.key} day`)
			),
			...rules.limits.map((limit) =>
				!('counts_beyond_normal_when' in limit) ||
				(limit.counts_beyond_normal_when ?? '').trim() === ''
					? null
					: faultIn(
							limit.counts_beyond_normal_when ?? '',
							'work_day',
							'boolean',
							`Limit ${limit.key} beyond-normal day`
						)
			),

			rules.time_off_in_lieu == null
				? null
				: faultIn(
						rules.time_off_in_lieu.expiry_months,
						'person',
						'number',
						'Time off in lieu expiry months'
					),
			...(rules.proration_by ?? []).map((arm, index) =>
				faultIn(arm.when, 'person', 'boolean', `Proration arm ${index + 1}`)
			),
			...(['ordinary_add', 'overtime_add'] as const).map((key) => {
				const add = rules.night_premium?.[key];
				return typeof add === 'string'
					? faultIn(add, 'work_day', 'number', `Night premium ${key}`)
					: null;
			})
		];
		return faults.find((fault) => fault != null) ?? true;
	})
);
export type WorkRules = Schema.Schema.Type<typeof workRulesValueSchema>;

export default defineCustomType({
	name: 'work_rules',
	description:
		'One version’s work rules: proration, the ordinary-rate divisor and overtime eligibility as expressions over the person, the ordered bands that price a day (and the limits above which planned OT is recorded as incentive hours), the limits schedules must respect (hours, and the consecutive-work-days rest rule), the breaks the law owes, the minimum wage by region, the night premium and holiday/rest precedence.',
	schema: Schema.toStandardSchemaV1(workRulesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
