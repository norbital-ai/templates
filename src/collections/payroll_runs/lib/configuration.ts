/**
 * Step 1 — PICK.
 *
 * Resolve everything the run is governed by, as of the period end, once: the jurisdiction settings
 * version in force for the company's lineage, and under it the statutory contributions with their
 * bands, the pay catalogue with its treatment grid, the atomic regime, the holidays and the leave
 * catalogue; the company's own shifts beside them. Nothing downstream reads configuration again,
 * so a version sealed halfway through a build cannot change an answer under it.
 *
 * The picked set is hashed into `payroll_runs.configuration_hash`. The hash is an **audit token**,
 * not a replay key: it says "these rows produced these payslips", and a rebuild that yields a
 * different hash is a rebuild against different law (decisions E32 / L29 / L30).
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { sha256Json } from '@norbital-ai/std/reckon';
import { decodeNumber } from '@norbital-ai/std/json';

import type { WorkspaceRow } from '../$types.js';
import { PAGE_LIMIT, type PayrollReadApi, type ReadLog } from './api.js';
import { bandAgeFloor, bandCeiling } from './bands.js';
import { monthBounds, monthKey, requiredDateKey, dateKey, type IsoDate } from './dates.js';
import { effectiveOn, live, overlapsRange } from './effective.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import type { PayrollWindow } from './period.js';
import type { ContributionTreatment } from '../../../datatypes/contribution_treatment/+definition.js';

type Company = WorkspaceRow<'companies'>;
/** The jurisdiction settings version the run is priced under; `configuration.jurisdiction` is this row. */
export type Jurisdiction = WorkspaceRow<'jurisdiction_settings'>;
export type PayComponent = WorkspaceRow<'pay_components'>;
type StatutoryRegime = NonNullable<Jurisdiction['regime']>;
export type OvertimeRule = StatutoryRegime['overtime_rules'][number];
type OvertimeLimit = StatutoryRegime['overtime_limits'][number];
export type OvertimeCoverageRule = StatutoryRegime['overtime_coverage'];
/**
 * `NonNullable` because the member is an optional key on the snapshot: a jurisdiction seeded before
 * it was restored carries no such property at all, which is the statement "this snapshot declares
 * no rest break rule" and not a missing value.
 */
type RestBreakRule = NonNullable<StatutoryRegime['rest_break_rules']>[number];
export type ShiftDefinition = WorkspaceRow<'shift_definitions'>;
export type ShiftPattern = WorkspaceRow<'shift_patterns'>;
export type LeaveType = WorkspaceRow<'leave_types'>;
export type ContributionRate = Pick<
	WorkspaceRow<'contribution_rates'>,
	'id' | 'statutory_contribution_id' | 'selector' | 'award' | 'summary' | 'approval_id'
>;
type Treatment = ContributionTreatment;
type StatutoryContribution = WorkspaceRow<'statutory_contributions'>;

/** One statutory scheme with the bands that were effective when the run was picked. */
export type ContributionConfig = {
	readonly row: StatutoryContribution;
	readonly rates: readonly ContributionRate[];
};

export type Configuration = {
	readonly company: Company;
	readonly jurisdiction: Jurisdiction;
	/** In `sequence` order — a relief is produced before the scheme that consumes it. */
	readonly contributions: readonly ContributionConfig[];
	/**
	 * `${pay_component_id}:${statutory_contribution_id}` → the component's cell for that scheme,
	 * read off `pay_components.contribution_treatments` by the scheme's code. Absent where the map
	 * names no such code: a decision nobody has made, which ACCUMULATE refuses by name.
	 */
	readonly treatments: ReadonlyMap<string, Treatment>;
	/** In `sequence` order — the order MEASURE walks. */
	readonly payComponents: readonly PayComponent[];
	readonly overtimeRules: readonly OvertimeRule[];
	readonly overtimeLimits: readonly OvertimeLimit[];
	/**
	 * The jurisdiction's statutory rest breaks, empty where it declares none.
	 *
	 * Picked here rather than read again downstream for the same reason every other member is: a
	 * snapshot end-dated halfway through a build cannot change an answer under the run. It needs no
	 * separate hash entry — `configurationSnapshot` already hashes `jurisdiction.regime` whole, so a
	 * changed break rule moves the audit token the way a changed overtime band does, and a
	 * jurisdiction that declares no rules contributes nothing and hashes exactly as it did before.
	 */
	readonly restBreakRules: readonly RestBreakRule[];
	/**
	 * Who the ladder covers, or null where the jurisdiction restricts coverage in no way.
	 *
	 * Null is a real answer and is not the same as "nobody is covered" — see `coverage.ts`.
	 */
	readonly overtimeCoverageRule: OvertimeCoverageRule | null;
	readonly shiftById: ReadonlyMap<string, ShiftDefinition>;
	/**
	 * The company's named shift patterns, keyed by id. `employment_terms.shift_pattern_id` is
	 * resolved through this map (`termPattern`), so the base an employment projects its days from
	 * is configuration the same way its roster codes are.
	 */
	readonly patternById: ReadonlyMap<string, ShiftPattern>;
	readonly holidays: ReadonlyMap<IsoDate, WorkspaceRow<'company_holidays'>>;
	readonly leaveTypes: readonly LeaveType[];
	readonly hash: string;
};

/** What `pickConfiguration` needs from the caller, apart from the window it reads. */
type PickConfigurationOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly companyId: string;
	/** The run's own window — period, salary range and attendance range, one fact. */
	readonly window: PayrollWindow;
};

function treatmentKey(payComponentId: string, contributionId: string): string {
	return `${payComponentId}:${contributionId}`;
}

export function lookupTreatment(
	configuration: Pick<Configuration, 'treatments'>,
	payComponentId: string,
	contributionId: string
): Treatment | undefined {
	return configuration.treatments.get(treatmentKey(payComponentId, contributionId));
}

/**
 * Bands ascending by ceiling; the open-ended band sorts last, then by age floor.
 *
 * A band whose selector is missing sorts first so that `selectBand` reaches it and reports the
 * seeding fault by name, rather than the order silently hiding it at the end of the ladder.
 */
function bandOrder(left: ContributionRate, right: ContributionRate): number {
	const ceiling = (rate: ContributionRate): number =>
		rate.selector == null ? Number.NEGATIVE_INFINITY : bandCeiling(rate.selector);
	const ageFloor = (rate: ContributionRate): number =>
		rate.selector == null ? 0 : bandAgeFloor(rate.selector);
	return ceiling(left) - ceiling(right) || ageFloor(left) - ageFloor(right);
}

/**
 * Load the configuration governing one company for one period.
 *
 * Everything is resolved as of the period end, except shifts and holidays, which are read across
 * the whole attendance window because a shift may legitimately be revised inside it.
 *
 * The window comes in whole, as `resolveWindow` produces it — the period, the salary range and the
 * attendance range are one fact in `period.ts`, and splitting them back apart here would be a
 * second vocabulary for it.
 */
export function pickConfiguration(
	options: PickConfigurationOptions
): Effect.Effect<Configuration, never, never> {
	return Effect.gen(function* () {
		const db = options.api.db;
		const asOf = options.window.salary.end;
		const rawWindowStart =
			options.window.attendance.start < options.window.salary.start
				? options.window.attendance.start
				: options.window.salary.start;
		const rawWindowEnd =
			options.window.attendance.end > options.window.salary.end
				? options.window.attendance.end
				: options.window.salary.end;
		// OT is paid on the attendance cutoff, but statutory limits and substitute holidays are
		// determined by calendar month. Pick every shift touching the full calendar months involved.
		const windowStart = monthBounds(monthKey(rawWindowStart)).start;
		const windowEnd = monthBounds(monthKey(rawWindowEnd)).end;
		const approved = { approval_id: { isNull: true } } as const;

		const companies = yield* db.companies.findMany({
			where: { id: { eq: options.companyId }, ...approved },
			limit: 100
		});
		const company = effectiveOn(companies, asOf);
		if (!company) refuse(`No company ${options.companyId} is effective on ${asOf}.`);

		// The company binds to a lineage by code; the governing version is the sealed, unvoided one
		// whose period covers the run. A draft never governs; a voided one never governs again.
		const code = company.settings_code;
		const versionRows = yield* db.jurisdiction_settings.findMany({
			where: { code: { eq: code }, ...approved },
			limit: 100
		});
		if (versionRows.length >= 100)
			refuse('Jurisdiction settings history is truncated; payroll cannot choose safely.');
		const jurisdiction = settingsInForce(live(versionRows), code, asOf);
		if (jurisdiction == null)
			refuse(
				`${company.name} operates under jurisdiction settings ${code}, which has no sealed version ` +
					`covering ${asOf}, so its ${options.window.period} payroll cannot be priced. Seal a ` +
					`${code} version whose effective range covers the period.`
			);

		const [contributionRows, payComponentRows, shiftRows, patternRows, holidayRows, leaveTypeRows] =
			yield* Effect.all(
				[
					db.statutory_contributions.findMany({
						where: { settings_id: { eq: jurisdiction.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.pay_components.findMany({
						where: { settings_id: { eq: jurisdiction.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.shift_definitions.findMany({
						where: { company_id: { eq: company.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.shift_patterns.findMany({
						where: { company_id: { eq: company.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.company_holidays.findMany({
						where: { settings_id: { eq: jurisdiction.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.leave_types.findMany({
						where: { settings_id: { eq: jurisdiction.id }, ...approved },
						limit: PAGE_LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
		// Every collection pages to the same ceiling and is checked: a configuration read that came
		// back truncated would drop law — a missing holiday, a missing band — and still produce a
		// payslip, which is the one outcome worse than producing none.
		options.api.reads.assertComplete(contributionRows, 'statutory contributions');
		options.api.reads.assertComplete(payComponentRows, 'pay components');
		options.api.reads.assertComplete(shiftRows, 'shift definitions');
		options.api.reads.assertComplete(patternRows, 'shift patterns');
		options.api.reads.assertComplete(holidayRows, 'company holidays');
		options.api.reads.assertComplete(leaveTypeRows, 'leave types');

		// Version scoping replaces per-row effective dating: the version governs its period whole and
		// carries its own scheme, rate, catalogue and holiday rows; there is no second copy to overlay.
		const contributions = live(contributionRows).toSorted(
			(left, right) => decodeNumber(left.sequence) - decodeNumber(right.sequence)
		);

		const contributionIds = contributions.map((row) => row.id);
		const rateRows = contributionIds.length
			? yield* db.contribution_rates.findMany({
					where: { statutory_contribution_id: { in: contributionIds }, ...approved },
					limit: PAGE_LIMIT
				})
			: [];
		options.api.reads.assertComplete(rateRows, 'contribution rates');

		const ratesByContribution = new Map<string, ContributionRate[]>();
		for (const rate of live(rateRows)) {
			const bucket = ratesByContribution.get(rate.statutory_contribution_id);
			if (bucket) bucket.push(rate);
			else ratesByContribution.set(rate.statutory_contribution_id, [rate]);
		}

		const payComponents = live(payComponentRows).toSorted(
			(left, right) => decodeNumber(left.sequence) - decodeNumber(right.sequence)
		);
		// The grid is keyed by scheme code on the catalogue row and by scheme id here, because the
		// run charges against the rows it picked: a code names the same law on every settings
		// version, and the picked version says which row that is for this period.
		const treatments = new Map<string, Treatment>();
		for (const component of payComponents)
			for (const contribution of contributions) {
				const cell = component.contribution_treatments?.[contribution.code];
				if (cell != null) treatments.set(treatmentKey(component.id, contribution.id), cell);
			}

		const shifts = live(shiftRows).filter((row) =>
			overlapsRange(row.effective_range, windowStart, windowEnd)
		);

		const regime = jurisdiction.regime;
		if (regime == null)
			refuse(`Jurisdiction ${jurisdiction.code} has no statutory regime snapshot.`);

		const configuration = {
			company,
			jurisdiction,
			contributions: contributions.map((row) => ({
				row,
				rates: (ratesByContribution.get(row.id) ?? []).toSorted(bandOrder)
			})),
			treatments,
			payComponents,
			overtimeRules: regime.overtime_rules,
			overtimeLimits: regime.overtime_limits,
			restBreakRules: regime.rest_break_rules ?? [],
			overtimeCoverageRule: regime.overtime_coverage,
			shiftById: new Map(shifts.map((row) => [row.id, row])),
			// Every pattern, whatever its effective range: a terms row in force names its pattern
			// outright, and a pattern that has lapsed is still the base of the days it covered.
			patternById: new Map(live(patternRows).map((row) => [row.id, row])),
			holidays: new Map(
				live(holidayRows).map((row) => [requiredDateKey(row.date, 'holiday date'), row] as const)
			),
			leaveTypes: live(leaveTypeRows)
		} satisfies Omit<Configuration, 'hash'>;

		return {
			...configuration,
			hash: sha256Json(configurationSnapshot(configuration, options.window.period))
		};
	});
}

/**
 * Hash the picked configuration. Only what governs the arithmetic is included — never the
 * population, never a timestamp — so two builds of the same month against unchanged law hash alike
 * and a changed hash always means changed law.
 */
export function configurationSnapshot(
	configuration: Omit<Configuration, 'hash'>,
	period: string
): Record<string, unknown> {
	// repository-health:allow AR5 -- This is the deliberately smaller, stable hash projection: its external keys and normalized values are the configuration identity, not a reconstruction of Configuration.
	return {
		period,
		company: configuration.company.id,
		jurisdiction: configuration.jurisdiction.id,
		proration: configuration.jurisdiction.proration,
		ordinary_rate: configuration.jurisdiction.ordinary_rate,
		tax_year_start_month: configuration.jurisdiction.tax_year_start_month,
		// The whole calendar: a company that moves its cutoff or starts paying twice a month
		// produces different payslips for the same month, so the hash has to move with it.
		pay_calendar: [configuration.company.pay_cutoff_day, configuration.company.pay_frequency],
		contributions: configuration.contributions.map((entry) => ({
			code: entry.row.code,
			sequence: entry.row.sequence,
			payer: entry.row.payer,
			keyed_by: entry.row.keyed_by,
			rounding: entry.row.rounding,
			special_rules: [...entry.row.special_rules].toSorted(),
			relief_for: [...entry.row.relief_for].toSorted(),
			rates: entry.rates.map((rate) => [rate.selector, rate.award])
		})),
		// One entry per decided cell. The OVERTIME and OVERTIME_EXCESS rows are in here like every
		// other component, so what EPF does with overtime moves the hash the way a band does.
		treatments: [...configuration.treatments]
			.map(([key, treatment]) => [key, treatment])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		pay_components: configuration.payComponents
			.map((row) => [
				row.code,
				row.is_statutory,
				row.policy,
				row.sequence,
				row.definition,
				row.eligibility,
				row.contribution_treatments
			])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// The effective range and the complete nested value are retained together. A PAID run can
		// therefore replay the exact coverage, awards, ceilings and authorities it used; it cannot
		// accidentally combine independently effective rows from different revisions.
		statutory_regime: {
			effective_range: configuration.jurisdiction.effective_range,
			value: configuration.jurisdiction.regime
		},
		holidays: [...configuration.holidays.values()]
			.map((row) => [
				requiredDateKey(row.date, 'holiday date'),
				dateKey(row.substitutes_date),
				row.scope
			])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		leave_types: configuration.leaveTypes
			.map((row) => [row.code, row.accrual, row.entitlement, row.payroll_effect])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// Codes are configuration because their polymorphic variant decides whether a scheduled day
		// is work, protected rest or another off day, and a WORK code owns its clock window.
		roster_codes: [...configuration.shiftById.values()]
			.map((row) => [row.code, row.variant, row.effective_range])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// Patterns are the base every employment projects its days from: change one cycle and every
		// employment on it is scheduled differently, so the hash moves with it like a code's window.
		shift_patterns: [...configuration.patternById.values()]
			.map((row) => [row.code, row.pattern, row.effective_range])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0])))
	};
}
