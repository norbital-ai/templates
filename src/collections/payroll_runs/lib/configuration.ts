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

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { sha256Json } from '@norbital-ai/std/reckon';
import type { WorkspaceRow } from '../$types.js';
import { PAGE_LIMIT, type PayrollReadApi, type ReadLog } from './api.js';
import { bandAgeFloor, bandCeiling } from './bands.js';
import { monthBounds, monthKey, type IsoDate } from './dates.js';
import { coversDate, effectiveOn, live, overlapsRange } from './effective.js';
import { sealedProfileCovering } from '../../../lib/statutory_profile.js';
import type { PayrollWindow } from './period.js';

type Company = WorkspaceRow<'companies'>;
export type Jurisdiction = WorkspaceRow<'jurisdictions'>;
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
export type LeaveType = WorkspaceRow<'leave_types'>;
export type ContributionRate = WorkspaceRow<'contribution_rates'>;
type Treatment = NonNullable<PayComponent['policy']>['statutory_treatments'][number];
type StatutoryContribution = WorkspaceRow<'statutory_contributions'>;
type OvertimeTreatment = NonNullable<StatutoryContribution['overtime_treatments']>[number];

/** One statutory scheme with the bands that were effective when the run was picked. */
export type ContributionConfig = {
	readonly row: StatutoryContribution;
	readonly rates: readonly ContributionRate[];
	/**
	 * What this scheme does with derived overtime, and with the excess the daily total-work-hours
	 * boundary reclassifies — the one entry of each schedule that was in force on the period end.
	 *
	 * `undefined` is a scheme that has stated no overtime position. That is a missing decision, not
	 * an exemption, and ACCUMULATE refuses the run rather than reading the silence as `EXCLUDE`.
	 */
	readonly overtimeTreatment: OvertimeTreatment | undefined;
	readonly overtimeExcessTreatment: OvertimeTreatment | undefined;
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

/** The two schedule columns on a statutory contribution that each carry an overtime position set. */
type OvertimeScheduleColumn = keyof Pick<
	StatutoryContribution,
	'overtime_treatments' | 'overtime_excess_treatments'
>;

/**
 * The one overtime position a scheme's schedule states for a date.
 *
 * Two entries covering the same day is a seeding fault, not a preference: nothing here could pick
 * between them, and picking the first would make the answer depend on array order.
 */
type EffectiveOvertimeTreatmentOptions = {
	readonly row: Pick<StatutoryContribution, 'code' | OvertimeScheduleColumn>;
	readonly column: OvertimeScheduleColumn;
	readonly asOf: IsoDate;
};

function effectiveOvertimeTreatment(
	options: EffectiveOvertimeTreatmentOptions
): OvertimeTreatment | undefined {
	const covering = (options.row[options.column] ?? []).filter((entry) =>
		coversDate(entry.effective_range, options.asOf)
	);
	if (covering.length > 1)
		refuse(
			`${options.row.code}.${options.column} states ${covering.length} overtime positions effective on ` +
				`${options.asOf}. A scheme charges overtime one way on any given day.`
		);
	return covering[0];
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

		// The company binds to a law family through its jurisdiction anchor; the governing profile is
		// the SEALED version of that family whose period covers the run. DRAFT profiles never govern;
		// VOIDED profiles keep their citations but are retired.
		const anchor = yield* db.jurisdictions.findFirst({
			where: { id: { eq: company.jurisdiction_id }, ...approved },
			columns: { code: true }
		});
		if (anchor == null)
			refuse(`Company ${company.name} states no jurisdiction anchor for ${asOf}.`);
		const profileRows = yield* db.jurisdictions.findMany({
			where: { code: { eq: anchor.code }, ...approved },
			limit: 100
		});
		const jurisdiction = sealedProfileCovering(live(profileRows), anchor.code, asOf);
		if (jurisdiction == null)
			refuse(
				`Company ${company.name} has no sealed statutory profile covering ${asOf}. Seal a ` +
					'version of its law family first.'
			);

		const [contributionRows, payComponentRows, shiftRows, holidayRows, leaveTypeRows] =
			yield* Effect.all(
				[
					db.statutory_contributions.findMany({
						where: { statutory_profile_id: { eq: jurisdiction.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.pay_components.findMany({
						where: { statutory_profile_id: { eq: jurisdiction.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.shift_definitions.findMany({
						where: { company_id: { eq: company.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.company_holidays.findMany({
						where: { company_id: { eq: company.id }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.leave_types.findMany({
						where: { company_id: { eq: company.id }, ...approved },
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
		options.api.reads.assertComplete(holidayRows, 'company holidays');
		options.api.reads.assertComplete(leaveTypeRows, 'leave types');

		// Profile scoping replaces per-row effective dating: the version governs its period whole.
		const contributions = live(contributionRows).toSorted(
			(left, right) => Number(left.sequence) - Number(right.sequence)
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
			(left, right) => Number(left.sequence) - Number(right.sequence)
		);
		const treatments = new Map<string, Treatment>();
		for (const component of payComponents) {
			for (const treatment of component.policy?.statutory_treatments ?? []) {
				if (
					!contributionIds.includes(treatment.statutory_contribution_id) ||
					!coversDate(treatment.effective_range, asOf)
				)
					continue;
				const key = treatmentKey(component.id, treatment.statutory_contribution_id);
				if (treatments.has(key))
					refuse(
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
			refuse(`Jurisdiction ${jurisdiction.code} has no statutory regime snapshot.`);

		const configuration = {
			company,
			jurisdiction,
			contributions: contributions.map((row) => ({
				row,
				rates: (ratesByContribution.get(row.id) ?? []).toSorted(bandOrder),
				overtimeTreatment: effectiveOvertimeTreatment({
					row,
					column: 'overtime_treatments',
					asOf
				}),
				overtimeExcessTreatment: effectiveOvertimeTreatment({
					row,
					column: 'overtime_excess_treatments',
					asOf
				})
			})),
			treatments,
			payComponents,
			overtimeRules: regime.overtime_rules,
			overtimeLimits: regime.overtime_limits,
			restBreakRules: regime.rest_break_rules ?? [],
			overtimeCoverageRule: regime.overtime_coverage,
			shiftById: new Map(shifts.map((row) => [row.id, row])),
			holidays: new Map(
				live(holidayRows).map((row) => [String(row.date).slice(0, 10), row] as const)
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
		ordinary_rate: [
			configuration.jurisdiction.ordinary_rate_basis,
			configuration.jurisdiction.ordinary_rate_divisor
		],
		tax_year_start_month: configuration.jurisdiction.tax_year_start_month,
		// The whole calendar, not only the monthly half of it: a company that changes when its
		// semi-monthly instalments open, close or pay produces different payslips for the same month,
		// so the hash has to move with it.
		pay_calendar: [
			configuration.company.pay_cutoff_day,
			configuration.company.pay_day,
			configuration.company.pay_calendar ?? null
		],
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
			rates: entry.rates.map((rate) => [rate.selector, rate.award]),
			// The overtime position is law the run was computed under exactly as a band is: change
			// what EPF does with overtime and the same month owes a different figure, so the hash has
			// to move. Only the entry actually in force is hashed, for the same reason only the
			// effective bands are.
			overtime: entry.overtimeTreatment?.treatment ?? null,
			overtime_excess: entry.overtimeExcessTreatment?.treatment ?? null
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
		statutory_leave: configuration.jurisdiction.statutory_leave,
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
