import { Schema } from 'effect';
import { compileExpression } from '../expressions/compile.js';
import { calendarDay } from '../iso-day.js';

/**
 * Region → monthly minimum wage, in the version's currency. A company names its
 * region; a scheme's `FLOOR:MINIMUM_WAGE` and `CAP:MINIMUM_WAGE_X:<n>` rules read the wage of that
 * region through `minimum_wage(region)`. A key may be a `province/locality` (see `placeWage`).
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
	/** Working days/week → monthly equivalent of an agreed daily wage (ID PP 36/2021 art.17). */
	daily_monthly_divisor_by_workweek: Schema.optionalKey(
		Schema.NullOr(Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0))))
	),
	/** A monthly-paid part-timer meets the order's hourly floor over contracted weekly hours. */
	part_time_monthly_hourly_floor: Schema.optionalKey(Schema.Boolean),
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
	/** Exact worksite, sector and establishment size select a seeded wage-order class. */
	classified_by_worksite: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				single_establishment_fact: Schema.String.check(Schema.isMinLength(1)),
				headcount_fact: Schema.String.check(Schema.isMinLength(1)),
				rows: Schema.Array(
					Schema.Struct({
						worksite: Schema.String.check(Schema.isMinLength(1)),
						sector: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
						employment_type: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
						min_workers: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
						max_workers: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
						rate_key: Schema.String.check(Schema.isMinLength(1))
					})
				)
			})
		)
	),
	/**
	 * Worksite → daily minimum wage, where the order fixes a day's rate by place (TH Notice 14).
	 * A key is a province or `province/district`; a district key overrides its province, and a
	 * worksite in a province with district keys must name its district. Each normal working day
	 * of a daily- or hourly-paid contract is held to the rate of the worksite its terms record that
	 * day, a shortened normal day to the whole rate (Notice 14 cl.19).
	 */
	daily_by_worksite: Schema.optionalKey(
		Schema.NullOr(Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0))))
	),
	/**
	 * `by_region` names workplaces: a person's monthly floor is read at the worksite their terms
	 * record (`terms.worksite`), the company's region where none is. The selected key must be exact:
	 * an unlisted locality cannot inherit a province's UMP because its UMK may be unseeded (ID UU
	 * 13/2003 art.88C as amended by UU 6/2023).
	 */
	workplace_keyed: Schema.optionalKey(Schema.Boolean),
	/** Bare workplace keys allowed where a province-wide order alone binds (ID: DKI Jakarta). */
	standalone_workplaces: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMinLength(1))))
	),
	/** KBLI edition used by the ID sector rows and ordinary-sector attestations below. */
	kbli_edition: Schema.optionalKey(Schema.Union([Schema.Literal('2020'), Schema.Literal('2025')])),
	/** First day a 2025 classification can be asserted (PerBPS 7/2025 art.7). */
	kbli_2025_from: Schema.optionalKey(calendarDay),
	/** Verified KBLI 2025 codes with exactly one corresponding 2020 sector class. */
	kbli_2025_to_2020: Schema.optionalKey(
		Schema.NullOr(
			Schema.Record(
				Schema.String.check(Schema.isPattern(/^[0-9]{5}$/)),
				Schema.String.check(Schema.isPattern(/^[0-9]{5}$/))
			)
		)
	),
	/**
	 * Sector minimum wages by place (ID PP 36/2021 as amended by PP 49/2025 art.35D; DKI Kep.33/2026,
	 * Jawa Tengah Kep.100.3.3.1/505/2025): a row binds a covered person whose worksite is at or
	 * inside `place`, whose `terms.worksite_sector` is one of `kbli` and for whom `when` holds. The
	 * monthly floor is the higher of the place's and every binding row's; `wage_floor` stays the
	 * place's (Perpres 82/2018 art.32(2)–(3) floors Kesehatan at the UMK or UMP, never a sector's).
	 */
	monthly_by_sector: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					place: Schema.String.check(Schema.isMinLength(1)),
					kbli: Schema.Array(Schema.String.check(Schema.isPattern(/^[0-9]{5}$/))).check(
						Schema.isMinLength(1)
					),
					when: Schema.optionalKey(Schema.NullOr(Schema.String)),
					amount: Schema.Finite.check(Schema.isGreaterThan(0))
				})
			)
		)
	),
	/** Places with an incomplete sector catalogue refuse an unverified ordinary-wage fallback. */
	strict_sector_places: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMinLength(1))))
	),
	/** Place and KBLI pairs checked against the applicable order and confirmed to owe only the ordinary floor. */
	verified_ordinary_sectors: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					place: Schema.String.check(Schema.isMinLength(1)),
					kbli: Schema.String.check(Schema.isPattern(/^[0-9]{5}$/))
				})
			)
		)
	),
	/** Worksite sector → daily minimum wage (TH Notice 14 cl.2(1)–(2)); the higher of it and the place binds. */
	daily_by_sector: Schema.optionalKey(
		Schema.NullOr(Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThan(0))))
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
	/** Refuse a payroll run whose covered contract fails `terms_when`. */
	block_terms_when: Schema.optionalKey(Schema.Boolean),
	/** Include fixed allowances when comparing the monthly contract to its wage floor. */
	floor_includes_fixed_allowances: Schema.optionalKey(Schema.Boolean),
	/** Refuse results-based terms whose monthly earned pay is not measured in the wage assessment. */
	block_unmeasured_results_pay: Schema.optionalKey(Schema.Boolean),
	/**
	 * Scheme codes whose employee share the monthly floor is net of: the contract less the month's
	 * employee charges of these schemes must meet it (CN-SH 沪人社规〔2025〕10号 item 4 excludes the
	 * employee's statutory social insurance and housing fund). Absent compares the contract gross.
	 */
	net_of_employee_schemes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
	/** A covered under-floor contract that must prevent a payroll run, over the person. */
	block_below_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * The order substitutes itself for a covered contract below it (TW 最低工資法 §5: 議定之工資低於
	 * 最低工資者，以本法所定之最低工資為其工資數額): the run pays the floor, restated in the contract's
	 * own unit, in place of the agreed rate, and warns. Absent pays the contract and warns.
	 */
	substitutes_below: Schema.optionalKey(Schema.Boolean),
	/** The wage order this table transcribes, in the operator's words; the engine never reads it. */
	authority: Schema.optionalKey(Schema.NullOr(Schema.String))
}).check(
	Schema.makeFilter((wages) => {
		const fault =
			(wages.monthly_by_sector ?? [])
				.map((row) =>
					row.when == null || row.when.trim() === ''
						? null
						: compileExpression({ expression: row.when, site: 'person', type: 'boolean' })
				)
				.find((fault) => fault != null) ??
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

/**
 * The full place a worksite or region names: a `province/locality` as written, a bare locality the
 * one key ending in it names (a regency or city name is unique nationally), anything else trimmed.
 */
export function canonicalPlace(table: Readonly<Record<string, number>>, place: string): string {
	const site = place.trim();
	if (site === '' || site.includes('/') || table[site] != null) return site;
	const named = Object.keys(table).filter((key) => key.endsWith(`/${site}`));
	return named.length === 1 ? named[0]! : site;
}

/**
 * The monthly floor a place owes under `table`, or null where it names none. A locality key
 * overrides its province; a locality without its own key owes the province's; a bare province
 * whose localities carry their own keys names no floor, since it does not say which one binds. A
 * table of one key (TW `Taiwan`) binds a place that names nothing.
 */
export function placeWage(table: Readonly<Record<string, number>>, place: string): number | null {
	const site = canonicalPlace(table, place);
	const keys = Object.keys(table);
	if (site === '') return keys.length === 1 ? table[keys[0]!]! : null;
	if (site.includes('/')) return table[site] ?? table[site.split('/')[0]!.trim()] ?? null;
	if (keys.some((key) => key.startsWith(`${site}/`))) return null;
	return table[site] ?? null;
}

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = Schema.toStandardSchemaV1(wagesValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
