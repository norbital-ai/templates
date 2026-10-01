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
	/**
	 * A worker employed on `on` whose worksite was reclassified to a lower region keeps the higher
	 * floor of the version in force that day (VN Decree 293/2025 art.5(5)). The terms facts
	 * `region_fact` (that day's region) and `reclassified_fact` (boolean) record the worksite.
	 */
	protected_prior_floor: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				on: calendarDay,
				region_fact: Schema.String.check(Schema.isMinLength(1)),
				reclassified_fact: Schema.String.check(Schema.isMinLength(1)),
				authority: Schema.optionalKey(Schema.NullOr(Schema.String))
			})
		)
	),
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
						rate_key: Schema.String.check(Schema.isMinLength(1)),
						/** Terms fact keys whose recorded evidence must exist before this class prices a wage. */
						requires_evidence: Schema.optionalKey(
							Schema.Array(Schema.String.check(Schema.isMinLength(1)))
						)
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
	/**
	 * The sector classification a sector row, an ordinary-sector attestation and a worksite code are
	 * stated in (ID: KBLI, PerBPS 7/2025): every code matches `sector_code_pattern`; a worksite
	 * attests its edition in `terms.facts.worksite_sector_edition`, one of `sector_editions`; the
	 * rows are in `sector_edition`. Present, it classifies every worksite sector before pricing.
	 */
	sector_code_pattern: Schema.optionalKey(
		Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))
	),
	sector_editions: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMinLength(1))))
	),
	sector_edition: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))),
	/** First day the last of `sector_editions` can be asserted (ID: PerBPS 7/2025 art.7). */
	sector_edition_from: Schema.optionalKey(calendarDay),
	/** Verified codes of the last of `sector_editions` with exactly one `sector_edition` class. */
	sector_edition_map: Schema.optionalKey(
		Schema.NullOr(Schema.Record(Schema.String, Schema.String))
	),
	/**
	 * Sector minimum wages by place (ID PP 36/2021 as amended by PP 49/2025 art.35D; DKI Kep.33/2026,
	 * Jawa Tengah Kep.100.3.3.1/505/2025): a row binds a covered person whose worksite is at or
	 * inside `place`, whose classified worksite sector is one of `sector_codes` and for whom `when`
	 * holds. The monthly floor is the higher of the place's and every binding row's; `wage_floor`
	 * stays the place's (Perpres 82/2018 art.32(2)–(3) floors Kesehatan at the UMK or UMP, never a
	 * sector's). A matched row whose `valid_when` (over the person, `company.facts` dated) is false
	 * refuses with its `validation_message`.
	 */
	monthly_by_sector: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					place: Schema.String.check(Schema.isMinLength(1)),
					sector_codes: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
						Schema.isMinLength(1)
					),
					when: Schema.optionalKey(Schema.NullOr(Schema.String)),
					valid_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
					validation_message: Schema.optionalKey(
						Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/)))
					),
					amount: Schema.Finite.check(Schema.isGreaterThan(0))
				})
			)
		)
	),
	/** Places with an incomplete sector catalogue refuse an unverified ordinary-wage fallback. */
	strict_sector_places: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMinLength(1))))
	),
	/** Place and sector code pairs checked against the applicable order and confirmed to owe only the ordinary floor. */
	verified_ordinary_sectors: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					place: Schema.String.check(Schema.isMinLength(1)),
					sector_code: Schema.String.check(Schema.isMinLength(1))
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
	/**
	 * Named rules a covered contract must meet, judged where `terms_when` is on each floor segment:
	 * where `when` holds of the person and `holds` does not, the run raises `message` at `severity`
	 * (a BLOCKER refuses the run). Both are booleans over the person as of the segment's last day,
	 * `employment.rule_date` its first (ID PP 36/2021 arts.20–24: a wage scale from one year's service).
	 */
	contract_rules: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					key: Schema.String.check(Schema.isMinLength(1)),
					when: Schema.String.check(Schema.isMinLength(1)),
					holds: Schema.String.check(Schema.isMinLength(1)),
					severity: Schema.Union([Schema.Literal('BLOCKER'), Schema.Literal('WARNING')]),
					message: Schema.String.check(Schema.isMinLength(1)),
					authority: Schema.optionalKey(Schema.NullOr(Schema.String))
				})
			)
		)
	),
	/**
	 * An hourly wage's floor is the monthly floor over `from_monthly_divisor` (ID PP 36/2021 art.16:
	 * ÷ 126), and an hourly wage is permitted only where `allowed_when` holds of the person; elsewhere
	 * the run refuses with `refusal`. Absent, an hourly rate meets `hourly_by_region`.
	 */
	hourly_floor: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				from_monthly_divisor: Schema.Finite.check(Schema.isGreaterThan(0)),
				allowed_when: Schema.String.check(Schema.isMinLength(1)),
				refusal: Schema.String.check(Schema.isMinLength(1)),
				authority: Schema.optionalKey(Schema.NullOr(Schema.String))
			})
		)
	),
	/** Include fixed allowances when comparing the monthly contract to its wage floor. */
	floor_includes_fixed_allowances: Schema.optionalKey(Schema.Boolean),
	/** Refuse results-based terms whose monthly earned pay is not measured in the wage assessment. */
	block_unmeasured_results_pay: Schema.optionalKey(Schema.Boolean),
	/** How results (piece, task, trip, commission) wages are measured and when they are refused. */
	results_pay: Schema.optionalKey(
		Schema.Struct({
			/** A PIECE_RATE salary is the recorded units × unit rate, whatever the base salary. */
			measure_piece_from_units: Schema.optionalKey(Schema.Boolean),
			/**
			 * Leave charged to a calendar-day catalogue (`entitlement.calendar_days`): piece-paid, it
			 * refuses (TH LPA s.60's preceding-period average is absent); on a DAILY or HOURLY contract
			 * its non-work days are paid a normal day.
			 */
			piece_calendar_leave_refused: Schema.optionalKey(Schema.Boolean),
			/** Weeks of prior piece workdays read for a PIECE_RATE leaver (TH s.118: up to 400 workdays). */
			piece_history_weeks: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
			/** Ad hoc catalogue codes priced from that piece history, with unrecorded scheduled days. */
			piece_history_catalogues: Schema.optionalKey(Schema.Array(Schema.String)),
			/** Zero-base TASK_BASIS pay with leave, holiday, clocked work or overtime refuses. */
			task_only_time_events_refused: Schema.optionalKey(Schema.Boolean),
			/** Scheme code whose levy refuses zero-basic results wages it cannot classify (MY HRDF). */
			levy_scheme: Schema.optionalKey(Schema.String),
			/**
			 * Who that levy refusal reaches: a boolean over the person (`company.headcount_citizens` is
			 * the run's citizen count), empty for everyone `levy_scheme` charges.
			 */
			applies_when: Schema.optionalKey(Schema.String),
			/** Ad hoc catalogue codes of the results wages `levy_scheme` cannot classify. */
			levy_unclassified_codes: Schema.optionalKey(Schema.Array(Schema.String)),
			/**
			 * Ad hoc catalogue codes whose requests are a zero-base TASK_BASIS month's results wages
			 * (task, trip, commission), the pay its monthly minimum is compared with. Absent, none is.
			 */
			results_wage_codes: Schema.optionalKey(Schema.Array(Schema.String)),
			/** Ad hoc catalogue code of the evidenced zero-results attestation for such a month. */
			zero_results_code: Schema.optionalKey(Schema.String)
		})
	),
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
		const keys = (wages.contract_rules ?? []).map((rule) => rule.key);
		if (new Set(keys).size !== keys.length) return 'Each contract rule needs its own key.';
		if (
			wages.sector_edition != null &&
			!(wages.sector_editions ?? []).includes(wages.sector_edition)
		)
			return 'The sector edition must be one of the sector editions.';
		if (wages.sector_code_pattern != null) {
			let pattern: RegExp;
			try {
				pattern = new RegExp(wages.sector_code_pattern);
			} catch {
				return 'The sector code pattern is not a valid regular expression.';
			}
			const codes = [
				...(wages.monthly_by_sector ?? []).flatMap((row) => row.sector_codes),
				...(wages.verified_ordinary_sectors ?? []).map((row) => row.sector_code),
				...Object.entries(wages.sector_edition_map ?? {}).flat()
			];
			const bad = codes.find((code) => !pattern.test(code));
			if (bad != null) return `Sector code ${bad} does not match the sector code pattern.`;
		}
		if (
			(wages.monthly_by_sector ?? []).some(
				(row) => (row.valid_when == null) !== (row.validation_message == null)
			)
		)
			return 'A sector row states valid_when and validation_message together.';
		const person = (expression: string) =>
			compileExpression({ expression, site: 'person', type: 'boolean' });
		const fault =
			(wages.contract_rules ?? [])
				.map((rule) => person(rule.when) ?? person(rule.holds))
				.find((fault) => fault != null) ??
			(wages.hourly_floor == null ? null : person(wages.hourly_floor.allowed_when)) ??
			person(wages.results_pay?.applies_when ?? '') ??
			(wages.monthly_by_sector ?? [])
				.flatMap((row) => [row.when, row.valid_when])
				.map((expression) =>
					expression == null || expression.trim() === ''
						? null
						: compileExpression({ expression, site: 'person', type: 'boolean' })
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
