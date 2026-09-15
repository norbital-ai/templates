import type { HolidaySnapshot } from '../../../datatypes/holiday_snapshots/+definition.js';
/**
 * Resolve the governing settings and family definitions once for the run. Holidays publish
 * individually; the exact published rows the run read are captured on it.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { sha256Json } from '@norbital-ai/std/reckon';

import type { WorkspaceRow } from '../$types.js';
import { prepareFamilyCatalogues } from '../../../lib/payroll/families.js';
import { PAGE_LIMIT, type PayrollReadApi, type ReadLog } from './api.js';
import { daysBetween, monthBounds, monthKey, type IsoDate } from './dates.js';
import { resolveHolidayInputs, type PreparedHolidayInput } from '../../../lib/holiday-inputs.js';
import { effectiveOn, live } from './effective.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import type { PayrollWindow } from './period.js';

import type { FamilyPayItem } from '../../../lib/payroll/family.js';

type Company = WorkspaceRow<'companies'>;
/** The jurisdiction settings version the run is priced under; `configuration.jurisdiction` is this row. */
export type Jurisdiction = WorkspaceRow<'jurisdiction_settings'>;
export type Work = Jurisdiction['work_rules'] & {
	/** The version that owns these rules. */
	readonly settings_id: string;
	/** The payroll jurisdiction, for the coverage classifications. */
	readonly jurisdiction_code: string;
};

/**
 * How a component produces its amount. Engine-internal: the four money catalogues store flat
 * columns and are lifted into the `ENTRY` arm when loaded; Work synthesizes the rest.
 *
 * - `ENTRY`            — a catalogue band prices the entry through the entry context.
 * - `SCHEDULE`         — the contracted amount from `employment_terms` (basic salary).
 * - `DERIVED_OVERTIME` — priced by the jurisdiction's regime from work days, never entered.
 * - `ABSENCE`          — unexplained absence, priced from the day wage.
 */
export type ComponentDefinition =
	| { readonly source: 'ENTRY' }
	| { readonly source: 'SCHEDULE'; readonly unit: 'MONEY'; readonly reducible: boolean }
	| { readonly source: 'DERIVED_OVERTIME'; readonly unit: 'MONEY' }
	| { readonly source: 'ABSENCE'; readonly unit: 'MONEY' };

export type CatalogueComponent = FamilyPayItem & { readonly definition: ComponentDefinition };
export type WorkLimit = Work['limits'][number];
type WorkBreak = Work['breaks'][number];
export type NightPremium = NonNullable<Work['night_premium']>;
export type ShiftDefinition = WorkspaceRow<'shift_definitions'>;
type ShiftPattern = WorkspaceRow<'shift_patterns'>;
type CatalogueLeave = WorkspaceRow<'leave_catalogue'>;
export type ContributionRule = WorkspaceRow<'statutory_contributions'>['rules'][number];
type StatutoryContribution = WorkspaceRow<'statutory_contributions'>;

/** One statutory scheme with the rules that were in force when the run was picked. */
export type ContributionConfig = {
	readonly row: StatutoryContribution;
	readonly rules: readonly ContributionRule[];
};

export type Configuration = {
	readonly company: Company;
	readonly jurisdiction: Jurisdiction;
	readonly work: Work;
	/** In dependency order — a relief is produced before the scheme that reads it. */
	readonly contributions: readonly ContributionConfig[];
	/** In the order MEASURE walks: the family pipeline, each family by code. */
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly holidayRestPrecedence: Work['holiday_rest_precedence'];
	/** The named hour ceilings; schedules must respect them, payroll reports overruns. */
	readonly limits: readonly WorkLimit[];
	/** The break obligations, as CEL over the work-day context. */
	readonly breaks: readonly WorkBreak[];
	/** The regime's night window and premiums, or null where it states none. Hashed with the regime. */
	readonly nightPremium: NightPremium | null;
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
	/** Every live version of the company's lineage, for the readers that cite older revisions. */
	readonly lineageVersions: readonly Jurisdiction[];
	readonly hash: string;
};

/** What `pickConfiguration` needs from the caller, apart from the window it reads. */
type PickConfigurationOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly companyId: string;
	/** The run's own window — period, salary range and attendance range, one fact. */
	readonly window: PayrollWindow;
};

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

		// The company's roster codes and named patterns: what every scheduled day is priced from.
		// Loaded across the whole attendance window because a shift may be revised inside it (the
		// same reading `resolveWindow` gives holidays), and read once for the work catalogue too.
		const [shiftRows, patternRows] = yield* Effect.all(
			[
				db.shift_definitions.findMany({
					where: { company_id: { eq: company.id }, ...approved },
					limit: PAGE_LIMIT
				}),
				db.shift_patterns.findMany({
					where: { company_id: { eq: company.id }, ...approved },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(shiftRows, 'shift definitions');
		options.api.reads.assertComplete(patternRows, 'shift patterns');
		const familyConfiguration = yield* prepareFamilyCatalogues({
			api: options.api,
			jurisdiction,
			companyId: company.id,
			windowStart,
			windowEnd,
			shiftRows: live(shiftRows),
			patternRows: live(patternRows)
		});
		const { contributions } = familyConfiguration;
		// The catalogue rows carry `destination` and `direction` as text at the database boundary,
		// where the models constrain them to the landing vocabulary. The engine restates the spine once,
		// here, so every consumer prices a catalogue component rather than a raw row.
		const catalogueComponents =
			familyConfiguration.catalogueComponents as readonly CatalogueComponent[];
		const holidayRows = yield* db.jurisdiction_holidays.findMany({
			where: {
				company_id: { eq: company.id },
				date: { gte: windowStart, lte: windowEnd },
				published_at: { isNotNull: true },
				...approved
			},
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(holidayRows, 'published holidays');
		const resolvedCalendar = resolveHolidayInputs(
			live(holidayRows),
			company.id,
			daysBetween(windowStart, windowEnd)
		);

		const configuration = {
			company,
			jurisdiction,
			lineageVersions: live(versionRows),
			...familyConfiguration,
			catalogueComponents,
			shiftById: new Map(live(shiftRows).map((row) => [row.id, row])),
			patternById: new Map(live(patternRows).map((row) => [row.id, row])),
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
		work_rules: configuration.work,
		proration: configuration.work.proration,
		ordinary_rate: configuration.work.ordinary_divisor_days,
		tax_year_start_month: configuration.jurisdiction.payroll.tax_year_start_month,
		// The whole calendar: a company that moves its cutoff or starts paying twice a month
		// produces different payslips for the same month, so the hash has to move with it.
		pay_calendar: [configuration.company.pay_cutoff_day, configuration.company.pay_frequency],
		// The region and the wage it names bound a scheme's base, so they move the hash like a band.
		region: configuration.company.region ?? null,
		wages: configuration.jurisdiction.wages,
		contributions: configuration.contributions.map((entry) => ({
			code: entry.row.code,
			assessment_period: entry.row.assessment_period,
			employee_share_annual_cap: entry.row.employee_share_annual_cap ?? null,
			shared_cap_group: entry.row.shared_cap_group ?? null,
			project_relief_annually: entry.row.project_relief_annually,
			// The rules by identity, not by text: a scheme row is immutable once its version is
			// sealed and a draft edit moves its row version, so `[id, row_version]` names the same
			// law the text does. The text of a Third Schedule is hundreds of kilobytes, and hashing
			// it in JavaScript — three or four times a run — cost more than the payroll itself.
			rules: [entry.row.id, entry.row.row_version]
		})),
		// The catalogue's bands are configuration: an amount or a limit moving is a different charge
		// even when the same code pays it. A scheme's base rides its row version above.
		component_catalogue: configuration.catalogueComponents
			.map((row) => [
				row.code,
				row.destination,
				row.direction,
				row.definition,
				row.eligibility,
				row.bands
			])
			.toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
		// The effective range and the complete nested value are retained together. A PAID run can
		// therefore replay the exact coverage, awards, ceilings and authorities it used; it cannot
		// accidentally combine independently effective rows from different revisions.
		work_rules_version: {
			effective_range: configuration.jurisdiction.effective_range,
			value: configuration.work
		},
		// The holidays read stay in the run's immutable snapshot. Only classified dates affect
		// arithmetic identity; a holiday published later for another period changes nothing here.
		holiday_inputs: configuration.holidayInputs.map(({ company_id, date }) => ({
			company_id,
			date,
			observation: configuration.holidays.get(date) ?? null
		})),
		leave_catalogue: configuration.catalogueLeaves
			.map((row) => [row.code, row.entitlement, row.paid])
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
