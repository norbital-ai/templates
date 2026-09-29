import { resolveCompanyFacts, type CompanyFactRevision } from '../../../lib/declared-facts.js';
import type { HolidaySnapshot } from '../../../lib/datatypes/holiday_snapshots.js';
/**
 * Resolve the governing settings and family definitions once for the run. Holidays publish
 * individually; the exact published rows the run read are captured on it.
 */

import { refuse } from '../../../lib/refuse.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import type { PayrollWorld } from '../world.js';
import { prepareWorkCatalogue } from '../work.js';
import { workPayItems } from '../work-lines.js';
import { prepareMoneyCatalogues, type ReligiousHoliday } from '../money.js';
import { prepareLoanCatalogue } from '../loan.js';
import { prepareContributionCatalogue } from '../contribution.js';
import { prepareLeaveCatalogue } from '../../leave/payroll.js';
import { daysBetween, monthBounds, monthKey, type IsoDate } from './dates.js';
import {
	resolveHolidayInputs,
	resolveHolidays,
	type HolidayRow,
	type PreparedHolidayInput
} from '../../../lib/holiday-calendar.js';
import { coversDate, effectiveOn, live, overlapsRange } from './effective.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import type { PayrollWindow } from './period.js';
import { dateKey } from '../../../lib/iso-day.js';

import type { WorkPattern } from '../../../lib/datatypes/work_pattern.js';
import type { WorkRules } from '../../../lib/datatypes/work_rules.js';
import type { FamilyPayItem } from '../../../lib/payroll/family.js';

type Company = WorkspaceRow<'companies'>;
/** The jurisdiction settings version the run is priced under; `configuration.jurisdiction` is this row. */
export type Jurisdiction = WorkspaceRow<'jurisdiction_settings'>;
/** The version's work rules as their custom field's check admits them (`WorkRules`). */
export type Work = WorkRules & {
	/** The version that owns these rules. */
	readonly settings_id: string;
	/** The payroll jurisdiction, for the coverage classifications. */
	readonly jurisdiction_code: string;
};

/**
 * How a component produces its amount. Engine-internal: the money catalogues store flat
 * columns and are lifted into the `ENTRY` arm when loaded; Work synthesizes the rest.
 *
 * - `ENTRY`            — a catalogue band prices the entry through the entry context.
 * - `SCHEDULE`         — the contracted amount from `employment_terms` (basic salary).
 * - `RESULTS_FLOOR`    — a separately shown monthly minimum-wage top-up for results pay.
 * - `DERIVED_OVERTIME` — priced by the jurisdiction's regime from work days, never entered.
 * - `DERIVED_NORMAL`   — additional normal-time wages priced from an agreed work day.
 * - `ABSENCE`          — unexplained absence, priced from the day wage.
 */
export type ComponentDefinition =
	| { readonly source: 'ENTRY' }
	| { readonly source: 'SCHEDULE'; readonly unit: 'MONEY'; readonly reducible: boolean }
	| { readonly source: 'RESULTS_FLOOR'; readonly unit: 'MONEY' }
	| { readonly source: 'DERIVED_OVERTIME'; readonly unit: 'MONEY' }
	| { readonly source: 'DERIVED_NORMAL'; readonly unit: 'MONEY' }
	| { readonly source: 'ABSENCE'; readonly unit: 'MONEY' };

export type CatalogueComponent = FamilyPayItem & { readonly definition: ComponentDefinition };
/** An hours ceiling; the consecutive-work-days rest limit is the roster gate's alone. */
export type WorkLimit = Exclude<
	Work['limits'][number],
	{ readonly measure: 'CONSECUTIVE_WORK_DAYS' }
>;
type WorkBreak = Work['breaks'][number];
export type NightPremium = NonNullable<Work['night_premium']>;
export type ShiftDefinition = WorkspaceRow<'shift_definitions'>;
/** A stored pattern is one arm of `WorkPattern`: the custom field's check admits nothing else. */
export type ShiftPattern = Omit<WorkspaceRow<'shift_patterns'>, 'pattern'> & {
	readonly pattern: WorkPattern;
};
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
	/** Raw declarations, before this run's defaults; historical cash-out uses its own version. */
	readonly recordedCompanyFacts: Company['facts'];
	/** Dated revisions of the entity facts, newest scope last; the run reads the one in force per day. */
	readonly companyFactRevisions: readonly CompanyFactRevision[];
	readonly jurisdiction: Jurisdiction;
	readonly work: Work;
	/** In dependency order — a relief is produced before the scheme that reads it. */
	readonly contributions: readonly ContributionConfig[];
	/** In the order MEASURE walks: the family pipeline, each family by code. */
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly holidayRestPrecedence: Work['holiday_rest_precedence'];
	/** `work_rules.last_rest_day_only`: a week's earlier REST days resolve as OFF (MY s.59(1)). */
	readonly lastRestDayOnly?: boolean | undefined;
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
	/** The published rows `holidays` was read from, so one employment can be re-read at its worksite. */
	readonly holidayRows: readonly HolidayRow[];
	/** The window `holidays` covers. */
	readonly holidayWindow: { readonly start: IsoDate; readonly end: IsoDate };
	/**
	 * Every published day of the calendar years the window touches that names a religion, whatever
	 * the window: a THR ceiling counts the worker's holidays across the whole year (ID Permenaker
	 * 6/2016 art.5(2)).
	 */
	readonly religiousHolidays: readonly ReligiousHoliday[];
	readonly catalogueLeaves: readonly CatalogueLeave[];
	/** Every live version of the company's lineage, for the readers that cite older revisions. */
	readonly lineageVersions: readonly Jurisdiction[];
	/**
	 * Every allowance class of the lineage by id, to its code. A contract lists a class by the row
	 * of the version it was signed under; a later version clones the row under a new id, and the
	 * code is what carries the class across (`contractAllowanceClass`).
	 */
	readonly allowanceCodeById: ReadonlyMap<string, string>;
};

/**
 * Load the configuration governing one company for one period, as of the period end — except shifts
 * and holidays, read across the whole attendance window because a shift may be revised inside it.
 */
export function pickConfiguration(options: {
	readonly world: PayrollWorld;
	readonly companyId: string;
	/** The run's own window — period, salary range and attendance range, one fact. */
	readonly window: PayrollWindow;
}): Configuration {
	const { world, companyId } = options;
	const asOf = options.window.salary.end;
	const rawWindowStart =
		options.window.attendance.start < options.window.salary.start
			? options.window.attendance.start
			: options.window.salary.start;
	const rawWindowEnd =
		options.window.attendance.end > options.window.salary.end
			? options.window.attendance.end
			: options.window.salary.end;
	// OT is paid on the attendance cutoff, but statutory limits are determined by calendar month.
	// Pick every shift touching the full calendar months involved.
	const windowStart = monthBounds(monthKey(rawWindowStart)).start;
	const windowEnd = monthBounds(monthKey(rawWindowEnd)).end;
	const ofCompany = <
		T extends { readonly approval_id?: string | null | undefined; readonly company_id: string }
	>(
		rows: readonly T[],
		id: string
	) => live(rows).filter((row) => row.company_id === id);

	const companyFactRevisions = ofCompany(world.company_facts, companyId);
	const company = effectiveOn(
		live(world.companies).filter((row) => row.id === companyId),
		asOf
	);
	if (!company) refuse(`No company ${companyId} is effective on ${asOf}.`);

	// The company binds to a lineage by code; the governing version is the sealed, unvoided one
	// whose period covers the run. A draft never governs; a voided one never governs again.
	const code = company.settings_code;
	const versionRows = live(world.jurisdiction_settings).filter((row) => row.code === code);
	const jurisdiction = settingsInForce(versionRows, code, asOf);
	if (jurisdiction == null)
		refuse(
			`${company.name} operates under jurisdiction settings ${code}, which has no sealed version ` +
				`covering ${asOf}, so its ${options.window.period} payroll cannot be priced. Seal a ` +
				`${code} version whose effective range covers the period.`
		);

	// The company's roster codes and named patterns: what every scheduled day is priced from.
	const shiftRows = ofCompany(world.shift_definitions, company.id);
	const patternRows = ofCompany(world.shift_patterns, company.id);
	const work = prepareWorkCatalogue(jurisdiction);
	const money = prepareMoneyCatalogues({
		world,
		settingsId: jurisdiction.id,
		lineageIds: versionRows.map((row) => row.id)
	});
	// The catalogue rows carry `destination` and `direction` as text at the database boundary; the
	// engine restates the spine once, here, so every consumer prices a catalogue component.
	const catalogueComponents = [
		...workPayItems(work.work),
		...money.components,
		...prepareLoanCatalogue(world, jurisdiction.id)
	].toSorted((a, b) =>
		a.code === b.code ? a.id.localeCompare(b.id) : a.code.localeCompare(b.code)
	) as readonly CatalogueComponent[];
	const holidayRows = ofCompany(world.jurisdiction_holidays, company.id).filter((row) => {
		const day = dateKey(row.date);
		return row.published_at != null && day >= windowStart && day <= windowEnd;
	});
	const resolvedCalendar = resolveHolidayInputs(
		holidayRows,
		company.id,
		daysBetween(windowStart, windowEnd)
	);
	const revisions = companyFactRevisions.map((row) => ({
		facts: row.facts ?? {},
		effective_range: row.effective_range,
		ph_wage_class_source_reference: row.ph_wage_class_source_reference,
		ph_wage_class_source_file: row.ph_wage_class_source_file
	}));

	return {
		recordedCompanyFacts: company.facts ?? {},
		companyFactRevisions: revisions,
		company: {
			...company,
			// The revision in force on the run's governing date prices the whole run; the current
			// company row remains the standing record when no revision covers it.
			facts: resolveCompanyFacts(jurisdiction.facts ?? [], company, { asOf, revisions })
		},
		jurisdiction,
		lineageVersions: versionRows,
		...work,
		contributions: prepareContributionCatalogue(world, jurisdiction.id),
		catalogueLeaves: prepareLeaveCatalogue(world, jurisdiction.id),
		allowanceCodeById: money.allowanceCodeById,
		catalogueComponents,
		shiftById: new Map(shiftRows.map((row) => [row.id, row])),
		patternById: new Map(patternRows.map((row) => [row.id, row as ShiftPattern])),
		holidays: resolvedCalendar.holidays,
		holidaySnapshots: resolvedCalendar.snapshots,
		holidayInputs: resolvedCalendar.inputs,
		holidayRows,
		holidayWindow: { start: windowStart, end: windowEnd },
		religiousHolidays: ofCompany(world.jurisdiction_holidays, company.id).flatMap((row) =>
			row.published_at != null && (row.religion ?? '').trim() !== ''
				? [{ date: dateKey(row.date), religion: row.religion! }]
				: []
		)
	};
}

/** A CN run has one sealed city profile. Every employed salary day must name a site it covers. */
export function assertProfileWorksites(
	configuration: Configuration,
	world: PayrollWorld,
	window: PayrollWindow
): void {
	if (configuration.jurisdiction.jurisdiction_code !== 'CN') return;
	const covered = configuration.jurisdiction.work_rules.wages?.by_region ?? {};
	const termsByEmployment = Map.groupBy(live(world.employment_terms), (row) => row.employment_id);
	const days = daysBetween(window.salary.start, window.salary.end);
	for (const employment of live(world.employments)) {
		if (
			employment.company_id !== configuration.company.id ||
			!overlapsRange(employment.effective_range, window.salary.start, window.salary.end)
		)
			continue;
		const terms = termsByEmployment.get(employment.id) ?? [];
		for (const day of days) {
			if (!coversDate(employment.effective_range, day)) continue;
			const site = terms.find((row) => coversDate(row.effective_range, day))?.worksite?.trim();
			if (site != null && Object.hasOwn(covered, site)) continue;
			refuse(
				`${employment.employee_number}: ${configuration.jurisdiction.code} cannot price ${day} ` +
					`at ${site ? `worksite "${site}"` : 'an unrecorded worksite'}. Record the contract ` +
					'performance place on dated employment terms; this run has one city profile and ' +
					'cannot substitute the company region or another city’s wage rules.'
			);
		}
	}
}

/**
 * The configuration as one employment observes it: the company's holidays plus the local days of
 * the worksite its terms record on each date (PH RA 12271, Navotas). Unchanged when no row is local.
 */
export function atWorksite<T extends Configuration>(
	configuration: T,
	terms: readonly Pick<WorkspaceRow<'employment_terms'>, 'effective_range' | 'worksite'>[]
): T {
	if (!configuration.holidayRows.some((row) => row.worksite?.trim())) return configuration;
	const holidays = resolveHolidays(
		configuration.holidayRows,
		configuration.company.id,
		configuration.holidayWindow.start,
		configuration.holidayWindow.end,
		(date) => terms.find((term) => coversDate(term.effective_range, date))?.worksite
	);
	return { ...configuration, holidays };
}

/**
 * Hash the picked configuration. Only what governs the arithmetic is included — never the
 * population, never a timestamp — so two builds of the same month against unchanged law hash alike
 * and a changed hash always means changed law.
 */
export function configurationSnapshot(
	configuration: Configuration,
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
		wages: configuration.jurisdiction.work_rules.wages,
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
			rules: [entry.row.id, entry.row.revision]
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
				row.bands,
				row.npl_prorates ?? null,
				row.outpatient_sick_pay ?? null,
				row.owed ?? null
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
		// Local days reach only their worksite, so they are identity apart from the dates above.
		...(configuration.holidaySnapshots.some((row) => row.worksite != null)
			? { local_holidays: configuration.holidaySnapshots.filter((row) => row.worksite != null) }
			: {}),
		leave_catalogue: configuration.catalogueLeaves
			.map((row) => [
				row.code,
				row.entitlement,
				row.is_npl,
				row.can_encash,
				row.pay_fraction,
				row.paid_by,
				row.consumes_code,
				row.unit
			])
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
