import type { HolidaySnapshot } from '../../../datatypes/holiday_snapshots/+definition.js';
/**
 * Resolve the governing settings and family definitions once for the run. Holidays publish
 * individually; the exact published rows the run read are captured on it.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { sha256Json } from '@norbital-ai/std/reckon';

import type { WorkspaceRow } from '../$types.js';
import type { EntitlementCap } from '../../../datatypes/entitlement_cap/+definition.js';
import { prepareFamilyCatalogues } from '../../../lib/payroll/families.js';
import { PAGE_LIMIT, type PayrollReadApi, type ReadLog } from './api.js';
import { daysBetween, monthBounds, monthKey, type IsoDate } from './dates.js';
import { resolveHolidayInputs, type PreparedHolidayInput } from '../../../lib/holiday-inputs.js';
import { effectiveOn, live } from './effective.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import type { PayrollWindow } from './period.js';
import type { ContributionTreatment } from '../../../datatypes/contribution_treatment/+definition.js';

import type { FamilyPayItem } from '../../../lib/payroll/family.js';

type Company = WorkspaceRow<'companies'>;
/** The jurisdiction settings version the run is priced under; `configuration.jurisdiction` is this row. */
export type Jurisdiction = WorkspaceRow<'jurisdiction_settings'>;
export type Work = WorkspaceRow<'work_catalogue'> & Pick<Jurisdiction, 'jurisdiction_code'>;

/**
 * How a component produces its amount. Engine-internal: the four money catalogues store flat
 * columns and are lifted into the `ENTRY` arm when loaded; Work synthesizes the rest.
 *
 * - `ENTRY`            — a person or an import supplies the number, under the entitlement matrix.
 * - `FORMULA`          — a CEL expression over the payslip context.
 * - `SCHEDULE`         — the contracted amount from `employment_terms` (basic salary).
 * - `DERIVED_OVERTIME` — priced by the jurisdiction's regime from work days, never entered.
 * - `ABSENCE`          — unexplained absence, priced from the day wage.
 */
export type ComponentDefinition =
	| { readonly source: 'ENTRY'; readonly cap: EntitlementCap | null }
	| {
			readonly source: 'FORMULA';
			readonly unit: 'MONEY' | 'DAYS' | 'HOURS' | 'RATE';
			readonly expr: string;
	  }
	| { readonly source: 'SCHEDULE'; readonly unit: 'MONEY'; readonly reducible: boolean }
	| { readonly source: 'DERIVED_OVERTIME'; readonly unit: 'MONEY' }
	| { readonly source: 'ABSENCE'; readonly unit: 'MONEY' };

export type CatalogueComponent = FamilyPayItem & { readonly definition: ComponentDefinition };
type StatutoryRegime = Work['regime'];
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
type CatalogueLeave = WorkspaceRow<'leave_catalogue'>;
export type ContributionRate = WorkspaceRow<'statutory_contributions'>['bands'][number];
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
	readonly work: Work;
	/** In `sequence` order — a relief is produced before the scheme that consumes it. */
	readonly contributions: readonly ContributionConfig[];
	/**
	 * `${pay_item_id}:${contribution_id}` → the family pay item's cell for that scheme,
	 * read from its `contribution_treatments` by the scheme's code. Absent where the map
	 * names no such code: a decision nobody has made, which ACCUMULATE refuses by name.
	 */
	readonly treatments: ReadonlyMap<string, Treatment>;
	/** In `sequence` order — the order MEASURE walks. */
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly holidayRestPrecedence: StatutoryRegime['holiday_rest_precedence'];
	readonly overtimeRules: readonly OvertimeRule[];
	readonly overtimeLimits: readonly OvertimeLimit[];
	/**
	 * The jurisdiction's statutory rest breaks, empty where it declares none.
	 *
	 * Picked here rather than read again downstream for the same reason every other member is: a
	 * snapshot end-dated halfway through a build cannot change an answer under the run. It needs no
	 * separate hash entry — `configurationSnapshot` already hashes `work.regime` whole, so a
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
	readonly holidays: ReadonlyMap<IsoDate, HolidaySnapshot>;
	readonly holidaySnapshots: readonly HolidaySnapshot[];
	readonly holidayInputs: readonly PreparedHolidayInput[];
	readonly catalogueLeaves: readonly CatalogueLeave[];
	readonly hash: string;
};

/** What `pickConfiguration` needs from the caller, apart from the window it reads. */
type PickConfigurationOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly companyId: string;
	/** The run's own window — period, salary range and attendance range, one fact. */
	readonly window: PayrollWindow;
};

function treatmentKey(componentCatalogueId: string, contributionId: string): string {
	return `${componentCatalogueId}:${contributionId}`;
}

/**
 * Bands ascending by ceiling; the open-ended band sorts last, then by age floor.
 *
 * A band whose selector is missing sorts first so that `selectBand` reaches it and reports the
 * seeding fault by name, rather than the order silently hiding it at the end of the ladder.
 */

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
		// OT is paid on the attendance cutoff, but statutory limits are
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

		const familyConfiguration = yield* prepareFamilyCatalogues({
			api: options.api,
			jurisdiction,
			companyId: company.id,
			windowStart,
			windowEnd
		});
		const { catalogueComponents, contributions } = familyConfiguration;
		const holidayRows = yield* db.jurisdiction_holidays.findMany({
			where: {
				jurisdiction_code: { eq: jurisdiction.jurisdiction_code },
				date: { gte: windowStart, lte: windowEnd },
				published_at: { isNotNull: true },
				...approved
			},
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(holidayRows, 'published holidays');
		const treatments = new Map<string, Treatment>();
		for (const component of catalogueComponents)
			for (const contribution of contributions) {
				const cell = component.contribution_treatments?.[contribution.row.code];
				if (cell != null) treatments.set(treatmentKey(component.id, contribution.row.id), cell);
			}
		const resolvedCalendar = resolveHolidayInputs(
			live(holidayRows),
			jurisdiction.jurisdiction_code,
			daysBetween(windowStart, windowEnd)
		);

		const configuration = {
			company,
			jurisdiction,
			...familyConfiguration,
			treatments,
			holidays: resolvedCalendar.holidays,
			holidaySnapshots: resolvedCalendar.snapshots,
			holidayInputs: resolvedCalendar.inputs
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
		work_catalogue: configuration.work,
		proration: configuration.work.proration,
		ordinary_rate: configuration.work.ordinary_rate,
		tax_year_start_month: configuration.jurisdiction.tax_year_start_month,
		// The whole calendar: a company that moves its cutoff or starts paying twice a month
		// produces different payslips for the same month, so the hash has to move with it.
		pay_calendar: [configuration.company.pay_cutoff_day, configuration.company.pay_frequency],
		contributions: configuration.contributions.map((entry) => ({
			code: entry.row.code,
			sequence: entry.row.sequence,
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
		component_catalogue: configuration.catalogueComponents
			.map((row) => [
				row.code,
				row.nature,
				row.sequence,
				row.definition,
				row.settlement ?? null,
				row.eligibility,
				row.contribution_treatments
			])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// The effective range and the complete nested value are retained together. A PAID run can
		// therefore replay the exact coverage, awards, ceilings and authorities it used; it cannot
		// accidentally combine independently effective rows from different revisions.
		statutory_regime: {
			effective_range: configuration.jurisdiction.effective_range,
			value: configuration.work.regime
		},
		// The holidays read stay in the run's immutable snapshot. Only classified dates affect
		// arithmetic identity; a holiday published later for another period changes nothing here.
		holiday_inputs: configuration.holidayInputs.map(({ jurisdiction_code, date }) => ({
			jurisdiction_code,
			date,
			observation: configuration.holidays.get(date) ?? null
		})),
		leave_catalogue: configuration.catalogueLeaves
			.map((row) => [row.code, row.entitlement, row.paid, row.treatments])
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
