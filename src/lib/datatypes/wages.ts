import { Schema } from 'effect';
import { compileExpression } from '../expressions/compile.js';
import { calendarDay } from '../iso-day.js';

/**
 * Region → monthly minimum wage, in the version's currency. A company names its
 * region; a scheme's `FLOOR:MINIMUM_WAGE` and `CAP:MINIMUM_WAGE_X:<n>` rules read the wage of that
 * region through `minimum_wage(region)`.
 */
export const wagesValueSchema = Schema.Struct({
	by_region: Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0))).check(
		Schema.makeFilter(
			(map) =>
				Object.keys(map).every((region) => region.trim() !== '') ||
				'A wage is keyed by a region; an empty region names nowhere.'
		)
	),
	/**
	 * Region → hourly minimum wage, where the order states one (VN Decree 293/2025 art.3(1)(b),
	 * TW 基本工資 per hour). An hourly-paid contract is held to it.
	 */
	hourly_by_region: Schema.optionalKey(
		Schema.NullOr(Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0))))
	),
	/** Weekly pay converted to a monthly comparator where the wage order states a factor (VN: 52/12). */
	weekly_monthly_factor: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(1))),
	/** Weekly/daily pay may satisfy either the monthly or hourly converted floor (VN art. 4(3)). */
	weekly_daily_hourly_alternative: Schema.optionalKey(Schema.Boolean),
	/** Incumbents retain the higher floor on this day after a locality reassignment (VN art. 5(5)). */
	protected_prior_floor_on: Schema.optionalKey(calendarDay),
	/** A monthly-paid part-timer's share of the monthly floor, where the jurisdiction states it. */
	part_time_monthly_full_time_week_hours: Schema.optionalKey(
		Schema.Finite.check(Schema.isGreaterThan(0))
	),
	/** A daily-paid part-timer's minimum is the hourly floor times the agreed normal hours/day. */
	part_time_daily_hourly_floor: Schema.optionalKey(Schema.Boolean),
	/**
	 * Employment type → region → monthly minimum wage, where a separate order sets that type's
	 * floor (PH RA 10361 s.24: the regional boards' domestic-worker wage orders, e.g. NCR-DW-06).
	 * A person of a type listed here is held to that table and never to `by_region`; a region the
	 * type's table omits states no floor for them.
	 */
	by_employment_type: Schema.optionalKey(
		Schema.NullOr(
			Schema.Record(
				Schema.String,
				Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0)))
			)
		)
	),
	/**
	 * Who the wages order covers: a boolean over the person, empty for everyone. A person it
	 * excludes — an intern on industrial training, an apprentice before the order reached them, a
	 * domestic servant — reads `wage_floor` as 0 in scheme rules, so a base floored at the minimum
	 * wage is not floored for them, while `minimum_wage(region)` still states the table for the
	 * ceilings that read it.
	 */
	applies_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * The share of the region's wage a covered person's floor is, over the person; absent is the
	 * whole wage. An apprentice or learner the order covers at 75% (PH Labor Code art.61, art.75)
	 * reads `wage_floor` as three quarters of the table while `minimum_wage(region)` still
	 * states the table.
	 */
	scale: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * What a covered contract must satisfy beyond the floor, over the person; absent is nothing.
	 * A composition rule (ID PP 36/2021 art.7(2): the basic wage is at least 75% of basic plus
	 * the fixed allowances) is judged where the floor is, and a contract that fails it warns on
	 * the run the same way.
	 */
	terms_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** A covered under-floor contract that must prevent a payroll run, over the person. */
	block_below_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** The wage order this table transcribes, in the operator's words; the engine never reads it. */
	authority: Schema.optionalKey(Schema.NullOr(Schema.String))
}).check(
	Schema.makeFilter((wages) => {
		const fault =
			compileExpression({
				expression: wages.applies_when,
				site: 'person',
				type: 'boolean'
			}) ??
			(wages.scale == null || wages.scale.trim() === ''
				? null
				: compileExpression({ expression: wages.scale, site: 'person', type: 'number' })) ??
			(wages.terms_when == null || wages.terms_when.trim() === ''
				? null
				: compileExpression({ expression: wages.terms_when, site: 'person', type: 'boolean' })) ??
			(wages.block_below_when == null || wages.block_below_when.trim() === ''
				? null
				: compileExpression({
						expression: wages.block_below_when,
						site: 'person',
						type: 'boolean'
					}));
		return fault == null || `Minimum wage coverage: ${fault}`;
	})
);

export type Wages = Schema.Schema.Type<typeof wagesValueSchema>;

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = Schema.toStandardSchemaV1(wagesValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
