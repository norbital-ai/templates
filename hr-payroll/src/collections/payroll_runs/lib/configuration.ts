/**
 * Step 1 — PICK.
 *
 * Resolve everything the run is governed by, as of the period end, once: the jurisdiction, its
 * statutory contributions and their bands, the treatment grid, the jurisdiction's atomic regime
 * snapshot, the company's pay catalogue, its shifts, its holidays and its leave policy. Nothing
 * downstream reads configuration again, so a snapshot end-dated halfway through a build cannot
 * change an answer under it.
 *
 * The picked set is hashed into `payroll_runs.configuration_hash`. The hash is an **audit token**,
 * not a replay key: it says "these rows produced these payslips", and a rebuild that yields a
 * different hash is a rebuild against different law (decisions E32 / L29 / L30).
 */

import { Effect } from 'effect';
import { sha256Json } from '@norbital-ai/std/reckon';
import type { WorkspaceRow } from '../$types.js';
import { assertComplete, PAGE_LIMIT, type PayrollReadApi } from './api.js';
import { bandAgeFloor, bandCeiling } from './bands.js';
import { monthBounds, monthKey, type IsoDate } from './dates.js';
import { coversDate, effectiveOn, live, overlapsRange } from './effective.js';

export type Company = WorkspaceRow<'companies'>;
export type Jurisdiction = WorkspaceRow<'jurisdictions'>;
export type PayComponent = WorkspaceRow<'pay_components'>;
type StatutoryRegime = NonNullable<Jurisdiction['regime']>;
export type OvertimeRule = StatutoryRegime['overtime_rules'][number];
export type OvertimeLimit = StatutoryRegime['overtime_limits'][number];
export type OvertimeCoverageRule = StatutoryRegime['overtime_coverage'];
export type ShiftDefinition = WorkspaceRow<'shift_definitions'>;
export type LeaveType = WorkspaceRow<'leave_types'>;
export type ContributionRate = WorkspaceRow<'contribution_rates'>;
export type Treatment = NonNullable<PayComponent['policy']>['statutory_treatments'][number];
export type StatutoryContribution = WorkspaceRow<'statutory_contributions'>;

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
	/** `${pay_component_id}:${statutory_contribution_id}` → the one effective cell. */
	readonly treatments: ReadonlyMap<string, Treatment>;
	/** In `sequence` order — the order MEASURE walks. */
	readonly payComponents: readonly PayComponent[];
	readonly overtimeRules: readonly OvertimeRule[];
	readonly overtimeLimits: readonly OvertimeLimit[];
	/**
	 * Who the ladder covers, or null where the jurisdiction restricts coverage in no way.
	 *
	 * Null is a real answer and is not the same as "nobody is covered" — see `coverage.ts`.
	 */
	readonly overtimeCoverageRule: OvertimeCoverageRule | null;
	readonly shiftById: ReadonlyMap<string, ShiftDefinition>;
	readonly holidays: ReadonlyMap<IsoDate, WorkspaceRow<'company_holidays'>>;
	readonly leaveTypes: readonly LeaveType[];
	readonly hash: string;
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
 */
export function pickConfiguration(options: {
	readonly api: PayrollReadApi;
	readonly companyId: string;
	readonly period: string;
	readonly salary: { readonly start: IsoDate; readonly end: IsoDate };
	readonly attendance: { readonly start: IsoDate; readonly end: IsoDate };
}): Effect.Effect<Configuration, never, never> {
	return Effect.gen(function* () {
		const { query } = options.api.db;
		const asOf = options.salary.end;
		const rawWindowStart =
			options.attendance.start < options.salary.start
				? options.attendance.start
				: options.salary.start;
		const rawWindowEnd =
			options.attendance.end > options.salary.end ? options.attendance.end : options.salary.end;
		// OT is paid on the attendance cutoff, but statutory limits and substitute holidays are
		// determined by calendar month. Pick every shift touching the full calendar months involved.
		const windowStart = monthBounds(monthKey(rawWindowStart)).start;
		const windowEnd = monthBounds(monthKey(rawWindowEnd)).end;
		const approved = { norbital_approval_id: { isNull: true } } as const;

		const companies = yield* query.companies.findMany({
			where: { norbital_id: { eq: options.companyId }, ...approved },
			limit: 100
		});
		const company = effectiveOn(companies, asOf);
		if (!company) throw new Error(`No company ${options.companyId} is effective on ${asOf}.`);

		const jurisdictions = yield* query.jurisdictions.findMany({
			where: { norbital_id: { eq: company.jurisdiction_id }, ...approved },
			limit: 100
		});
		const jurisdiction = effectiveOn(jurisdictions, asOf);
		if (!jurisdiction)
			throw new Error(`Company ${company.name} has no jurisdiction effective on ${asOf}.`);

		const [contributionRows, payComponentRows, shiftRows, holidayRows, leaveTypeRows] =
			yield* Effect.all(
				[
					query.statutory_contributions.findMany({
						where: { jurisdiction_id: { eq: jurisdiction.norbital_id }, ...approved },
						limit: PAGE_LIMIT
					}),
					query.pay_components.findMany({
						where: { company_id: { eq: company.norbital_id }, ...approved },
						limit: PAGE_LIMIT
					}),
					query.shift_definitions.findMany({
						where: { company_id: { eq: company.norbital_id }, ...approved },
						limit: PAGE_LIMIT
					}),
					query.company_holidays.findMany({
						where: { company_id: { eq: company.norbital_id }, ...approved },
						limit: PAGE_LIMIT
					}),
					query.leave_types.findMany({
						where: { company_id: { eq: company.norbital_id }, ...approved },
						limit: PAGE_LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
		// Every collection pages to the same ceiling and is checked: a configuration read that came
		// back truncated would drop law — a missing holiday, a missing band — and still produce a
		// payslip, which is the one outcome worse than producing none.
		assertComplete(contributionRows, 'statutory contributions');
		assertComplete(payComponentRows, 'pay components');
		assertComplete(shiftRows, 'shift definitions');
		assertComplete(holidayRows, 'company holidays');
		assertComplete(leaveTypeRows, 'leave types');

		const contributions = live(contributionRows)
			.filter((row) => coversDate(row.effective_range, asOf))
			.toSorted((left, right) => Number(left.sequence) - Number(right.sequence));

		const contributionIds = contributions.map((row) => row.norbital_id);
		const rateRows = contributionIds.length
			? yield* query.contribution_rates.findMany({
					where: { statutory_contribution_id: { in: contributionIds }, ...approved },
					limit: PAGE_LIMIT
				})
			: [];
		assertComplete(rateRows, 'contribution rates');

		const ratesByContribution = new Map<string, ContributionRate[]>();
		for (const rate of live(rateRows)) {
			if (!coversDate(rate.effective_range, asOf)) continue;
			const bucket = ratesByContribution.get(rate.statutory_contribution_id);
			if (bucket) bucket.push(rate);
			else ratesByContribution.set(rate.statutory_contribution_id, [rate]);
		}

		const payComponents = live(payComponentRows)
			.filter((row) => coversDate(row.effective_range, asOf))
			.toSorted((left, right) => Number(left.sequence) - Number(right.sequence));
		const treatments = new Map<string, Treatment>();
		for (const component of payComponents) {
			for (const treatment of component.policy?.statutory_treatments ?? []) {
				if (
					!contributionIds.includes(treatment.statutory_contribution_id) ||
					!coversDate(treatment.effective_range, asOf)
				)
					continue;
				const key = treatmentKey(component.norbital_id, treatment.statutory_contribution_id);
				if (treatments.has(key))
					throw new Error(
						`Pay component ${component.code} has overlapping statutory treatments for ${treatment.statutory_contribution_id}.`
					);
				treatments.set(key, treatment);
			}
		}

		const shifts = live(shiftRows).filter((row) =>
			overlapsRange(row.effective_range, windowStart, windowEnd)
		);

		const regime = jurisdiction.regime;
		if (regime == null)
			throw new Error(`Jurisdiction ${jurisdiction.code} has no statutory regime snapshot.`);

		const configuration = {
			company,
			jurisdiction,
			contributions: contributions.map((row) => ({
				row,
				rates: (ratesByContribution.get(row.norbital_id) ?? []).toSorted(bandOrder)
			})),
			treatments,
			payComponents,
			overtimeRules: regime.overtime_rules,
			overtimeLimits: regime.overtime_limits,
			overtimeCoverageRule: regime.overtime_coverage,
			shiftById: new Map(shifts.map((row) => [row.norbital_id, row])),
			holidays: new Map(
				live(holidayRows).map((row) => [String(row.date).slice(0, 10), row] as const)
			),
			leaveTypes: live(leaveTypeRows).filter((row) => coversDate(row.effective_range, asOf))
		} satisfies Omit<Configuration, 'hash'>;

		return { ...configuration, hash: hashConfiguration(configuration, options.period) };
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
	return {
		period,
		company: configuration.company.norbital_id,
		jurisdiction: configuration.jurisdiction.norbital_id,
		proration: configuration.jurisdiction.proration,
		ordinary_rate: [
			configuration.jurisdiction.ordinary_rate_basis,
			configuration.jurisdiction.ordinary_rate_divisor
		],
		tax_year_start_month: configuration.jurisdiction.tax_year_start_month,
		pay_calendar: [configuration.company.pay_cutoff_day, configuration.company.pay_day],
		overtime_calculation_method: configuration.company.overtime_calculation_method,
		// Settlement is part of the law a payslip was computed under: change when a joining period
		// settles and the same month produces a different set of payslips, so a rebuild must hash
		// differently rather than look like the same answer.
		settlement_policy: configuration.company.settlement_policy,
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
		treatments: [...configuration.treatments]
			.map(([key, treatment]) => [key, treatment.treatment])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		pay_components: configuration.payComponents
			.map((row) => [row.code, row.policy, row.sequence, row.definition, row.eligibility])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// The effective range and the complete nested value are retained together. A PAID run can
		// therefore replay the exact coverage, awards, ceilings and authorities it used; it cannot
		// accidentally combine independently effective rows from different revisions.
		statutory_regime: {
			effective_range: configuration.jurisdiction.effective_range,
			value: configuration.jurisdiction.regime
		},
		holidays: [...configuration.holidays.values()]
			.map((row) => [String(row.date).slice(0, 10), row.substitutes_date, row.scope])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		leave_types: configuration.leaveTypes
			.map((row) => [row.code, row.accrual, row.entitlement, row.payroll_effect])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// Codes are configuration because their polymorphic variant decides whether a scheduled day
		// is work, protected rest or another off day, and a WORK code owns its clock window.
		roster_codes: [...configuration.shiftById.values()]
			.map((row) => [row.code, row.variant, row.effective_range])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0])))
	};
}

function hashConfiguration(configuration: Omit<Configuration, 'hash'>, period: string): string {
	return sha256Json(configurationSnapshot(configuration, period));
}
