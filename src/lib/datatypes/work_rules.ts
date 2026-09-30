import { Schema } from 'effect';
import { nightPremiumValueSchema } from '../payroll/work-rules-values.js';
import { compileExpression } from '../expressions/compile.js';
import type { ExpressionSite, ExpressionType } from '../expressions/contexts.js';
import { openKeyMentions } from '../expressions/contexts.js';
import { prorationBasisValueSchema } from './proration_basis.js';
import { wagesValueSchema } from './wages.js';
import * as Predicate from 'effect/Predicate';

/**
 * The work rules of one settings version: they price schedule and attendance into BASIC, the
 * OVERTIME classes and INCENTIVE, and state the ceilings schedules respect. Every money decision is
 * an expression compiled at write time, named for what it returns (`_when` boolean, `_hours`,
 * `_minutes`, `_days`, `_amount` money): `proration` (the month's denominator),
 * `ordinary_divisor_days`, `overtime_when` (empty is everyone), `bands` (price the day in order,
 * incentive hours on each band's INCENTIVE line), `limits` (applied when schedules are written;
 * readable as `limits.<key>`), `breaks` (what the law owes) and `wages` (minimum wage by region).
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
	when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * Boolean over the work day: a day it holds on adds every hour worked on it to this limit's
	 * count, not only the hours beyond its normal day (TW 勞基法 §36(3): hours worked on a 休息日
	 * count toward the §32(2) overtime totals). An emergency day stays outside every ceiling.
	 * Read by the monthly, quarterly and yearly ceiling report only; absent is none.
	 */
	counts_day_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * Boolean over the work day: a day it holds on adds the hours worked beyond its normal day to
	 * this limit's count, where the measure left them out (TW 勞基法 §32(2) as read by 勞委會
	 * (89)台勞動二字第0041535號: hours past eight on a 例假 or a §37 休假日 are extended hours).
	 * `counts_day_when` wins on a day both hold. Read by the ceiling report only; absent is none.
	 */
	counts_beyond_normal_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * Payroll judges the limit too, over the compliance span the run reads, and refuses a breach: a
	 * weekly NORMAL_HOURS or ALL_OVERTIME_HOURS limit (TH LPA ss.23, 26). Absent is the roster gate
	 * and the ceiling report only.
	 */
	enforced_at_payroll: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	authority: Schema.optionalKey(Schema.NullOr(Schema.String))
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
	suspended_by_leave: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
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
				when: Schema.optionalKey(Schema.NullOr(Schema.String))
			})
		)
	),
	when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** Payroll re-judges the run of worked days over the compliance span (TH LPA s.28). Absent is the roster gate only. */
	enforced_at_payroll: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	authority: Schema.optionalKey(Schema.NullOr(Schema.String))
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
	counts_as_worked_time: Schema.optionalKey(Schema.NullOr(Schema.Boolean))
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
	 * The Work pay item's output this band posts to, where it prices the normal day rather than
	 * overtime: it is read on every ordinary scheduled day of the wage window, over the day's own
	 * worked hours (the presumed shift where unclocked), with its own consumption, and settles as
	 * additional normal-time wages. Absent is an overtime band.
	 */
	component: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))),
	/**
	 * The line an overtime-day band posts to instead of `OVERTIME`, where the law prices the day but
	 * does not count the pay as overtime: it settles as additional normal-time wages, read as `BASE`
	 * (MY EA s.60D(3)(a)(i) holiday work within the normal hours is not overtime under s.60A(3)(b),
	 * so it is EPF wages — KWSP Employer FAQ 21). Absent is `OVERTIME`. Not with `component`.
	 */
	line: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))),
	/**
	 * Inert: nothing reads it. It once named the day limit above which planned OT became incentive;
	 * every overtime limit now splits (`splitsOvertime`). Kept, and still compiled, only because
	 * sealed versions (MY-nihon, VN) store it.
	 */
	funnel_above_hours: Schema.optionalKey(Schema.NullOr(cel))
});
export type WorkRateBand = Schema.Schema.Type<typeof workRateBandValueSchema>;

const clockTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));

/**
 * One protection judged on a person-day: `when`, a boolean over the work day, is the breach. Judged
 * at payroll on every scheduled or attended day of the run's windows, in order, the first that holds
 * refusing with `message`; one that reads nothing but `day_facts` is judged when the day is saved too.
 */
const workDayRuleValueSchema = Schema.Struct({
	key: Schema.String.check(Schema.isMinLength(1)),
	when: cel,
	message: Schema.String.check(Schema.isMinLength(1)),
	authority: Schema.optionalKey(Schema.NullOr(Schema.String))
});
export type WorkDayRule = Schema.Schema.Type<typeof workDayRuleValueSchema>;

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
		Schema.NullOr(Schema.Array(Schema.Struct({ when: cel, basis: prorationBasisValueSchema })))
	),
	/**
	 * The law states no part-month divisor, so the contract's does: a terms row's `proration`
	 * replaces `proration` and `proration_by` for that row (VN Decree 145/2020 art.55(1)(a) prices
	 * overtime on the hours actually worked, Decree 293/2025 art.4 the floor on the full month,
	 * Law 41/2024 arts.33(5), 34(3) insurance on unpaid days — none fixes the divisor). Absent where
	 * a statute prescribes one, and a contract basis there is ignored.
	 */
	proration_contractual: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
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
	daily_month_days: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** A statutory ordinary rate taken from approved dated wage history instead of the current contract. */
	ordinary_rate_reference: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				reference: Schema.Literals(['PREVIOUS_WAGE_PERIOD', 'LATEST_DUE_MONTH']),
				pay_frequencies: Schema.Array(
					Schema.Literals(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'])
				).check(Schema.isMinLength(1)),
				daily_divisor: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
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
				required_facts: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
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
	gross_excluded_allowances: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
	/**
	 * Allowance codes outside the statute's wage, left out of `person.terms.fixed_allowances` and
	 * `monthly_wage` at every person site (MY EA s.2 "wages" (c): any travelling allowance). A
	 * scheme's own base is its `counts_toward`. Absent is none.
	 */
	wage_excluded_allowances: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
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
	normal_hours: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * Hours over the work day (`person`, `date`, `day_facts`, `stated_day_hours`): how long a
	 * rostered shift's normal day may run before its hours are overtime, where the law lets an
	 * agreement move it (TH LPA s.23: a redistributed day of nine hours; a guard's longer day).
	 * `stated_day_hours` is the default — the statute's normal day, bounded by the contract's
	 * stated day. Absent or empty is that default.
	 */
	shift_day_hours: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * Hours over the work day (`person`, `date`, `day_type`, `normal_hours`, `day_facts`): what an
	 * ordinary rostered day moves within its week — positive above the normal day, negative on a
	 * shorter one (TH LPA s.23: a redistributed day above eight is given back inside the week). A
	 * week whose moves sum above zero refuses. Judged with the weekly NORMAL_HOURS limits payroll
	 * enforces; absent or empty is none.
	 */
	redistributed_hours: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * The hours a week a full-time monthly-rated hour is built on, whatever the contract's week, where the
	 * statute fixes it (SG EA Fourth Schedule: 12 × monthly ÷ (52 × 44)); a cap on other wage
	 * bases' week. Absent where the hour is the day over the daily normal hours (MY s.60I(1)(b)).
	 */
	rate_week_hours: Schema.optionalKey(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0)))),
	part_time_week_hours_below: Schema.optionalKey(
		Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0)))
	),
	part_time_comparator_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	bands: Schema.Array(workRateBandValueSchema),
	limits: Schema.Array(Schema.Union([workLimitValueSchema, workRestLimitValueSchema])),
	breaks: Schema.Array(workBreakValueSchema),
	/** Region → monthly minimum wage in the version's currency, and who the order covers. */
	wages: wagesValueSchema,
	/** The instrument the rules transcribe; quoted by refusals. */
	authority: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
	holiday_rest_precedence: Schema.Literals(['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE']),
	/**
	 * Whether planned hours beyond the limits may be kept as incentive hours; false refuses them at
	 * write and at payroll (TH LPA s.26: work above the ceiling is unlawful, not priced). Absent is true.
	 */
	incentive_hours_allowed: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * Each occasion of overtime or holiday work needs the worker's prior consent
	 * (`work_days.overtime_consented_at`) on a day `required_when` (boolean over the work day) holds,
	 * unless the day records the `exception_fact` work-day input (TH LPA ss.24–25). Absent is none.
	 */
	overtime_consent: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				required_when: cel,
				exception_fact: Schema.String.check(Schema.isMinLength(1)),
				authority: Schema.optionalKey(Schema.NullOr(Schema.String))
			})
		)
	),
	/**
	 * The statute's night, local wall times; an end at or before the start crosses midnight. Read by
	 * `night_worked` and `first_night_at` (TH LPA s.47: 22:00–06:00). Absent: no day is a night day.
	 */
	night_window: Schema.optionalKey(
		Schema.NullOr(Schema.Struct({ start: clockTime, end: clockTime }))
	),
	/** Person-day protections (see `workDayRuleValueSchema`); absent or empty is none. */
	day_rules: Schema.optionalKey(Schema.NullOr(Schema.Array(workDayRuleValueSchema))),
	/**
	 * Where one Monday–Sunday week holds more than one REST day, only its last is the rest day and
	 * the earlier ones resolve as OFF days (MY Employment Act 1955 s.59(1): "the last of such rest
	 * days shall be the rest day for the purposes of this Part"). Absent: every REST day is one.
	 */
	last_rest_day_only: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * Work on a REST day with a later REST day in its Monday–Sunday week: `RESOLVE_AS_OFF` resolves
	 * it as an OFF day (as `last_rest_day_only`); `REFUSE` refuses paid work on it at payroll, where
	 * the statutory 104-hour count and the contract's rest-day rate are not priced together.
	 * Absent: every REST day is one.
	 */
	earlier_rest_day_work: Schema.optionalKey(
		Schema.NullOr(Schema.Literals(['RESOLVE_AS_OFF', 'REFUSE']))
	)
}).check(
	Schema.makeFilter((rules) => {
		if (rules.last_rest_day_only != null && rules.earlier_rest_day_work != null)
			return 'Rest days: set last_rest_day_only or earlier_rest_day_work, not both.';
		if (
			rules.encashment?.include_allowances.some((code) =>
				rules.encashment?.exclude_allowances.includes(code)
			)
		)
			return 'Leave cash-out: an allowance cannot be both included and excluded.';
		const enforcedFault = rules.limits.find(
			(limit) =>
				limit.enforced_at_payroll === true &&
				!isRestLimit(limit) &&
				!(
					limit.period === 'WEEK' &&
					(limit.measure === 'NORMAL_HOURS' || limit.measure === 'ALL_OVERTIME_HOURS')
				)
		);
		if (enforcedFault != null)
			return `Limit ${enforcedFault.key}: payroll enforces only a weekly NORMAL_HOURS or ALL_OVERTIME_HOURS limit, or the rest limit.`;
		const doubled = rules.bands.find((band) => band.line != null && band.component != null);
		if (doubled != null)
			return `Band ${doubled.label}: a normal-day band posts to its component; it cannot name a line too.`;
		const ruleKeys = (rules.day_rules ?? []).map((rule) => rule.key);
		if (new Set(ruleKeys).size !== ruleKeys.length) return 'Day rules: each key is declared once.';
		const limitKeys = new Set(rules.limits.map((limit) => limit.key));
		const expressions = [
			rules.ordinary_divisor_days,
			rules.overtime_when,
			rules.part_time_comparator_when ?? '',
			...rules.bands.flatMap((band) => [
				band.when,
				band.take_hours,
				band.price_amount,
				band.funnel_above_hours ?? ''
			]),
			rules.shift_day_hours ?? '',
			rules.redistributed_hours ?? '',
			...rules.breaks.flatMap((brk) => [brk.when, brk.owed_minutes]),
			rules.overtime_consent?.required_when ?? '',
			...(rules.day_rules ?? []).map((rule) => rule.when)
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
			(rules.part_time_comparator_when ?? '').trim() === ''
				? null
				: faultIn(
						rules.part_time_comparator_when ?? '',
						'work_day',
						'boolean',
						'Part-time comparator'
					),
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
			(rules.shift_day_hours ?? '').trim() === ''
				? null
				: faultIn(rules.shift_day_hours ?? '', 'work_day', 'hours', 'Shift day hours'),
			(rules.redistributed_hours ?? '').trim() === ''
				? null
				: faultIn(rules.redistributed_hours ?? '', 'work_day', 'hours', 'Redistributed hours'),
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

			rules.overtime_consent == null
				? null
				: faultIn(rules.overtime_consent.required_when, 'work_day', 'boolean', 'Overtime consent'),
			...(rules.day_rules ?? []).map((rule) =>
				faultIn(rule.when, 'work_day', 'boolean', `Day rule ${rule.key}`)
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
				return Predicate.isString(add)
					? faultIn(add, 'work_day', 'number', `Night premium ${key}`)
					: null;
			})
		];
		return faults.find((fault) => fault != null) ?? true;
	})
);
export type WorkRules = Schema.Schema.Type<typeof workRulesValueSchema>;

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = Schema.toStandardSchemaV1(workRulesValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
