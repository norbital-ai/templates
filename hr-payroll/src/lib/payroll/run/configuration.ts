import {
	requireFactValues,
	resolveCompanyFacts,
	resolveFactValues,
	type CompanyFactRevision
} from '../../../lib/declared-facts.js';
import type { FactKey } from '../../../lib/datatypes/fact_keys.js';
import {
	DATED,
	isEligible,
	personContext,
	scalarFacts,
	type DatedCompany,
	type DatedEmployee,
	type PersonContext
} from './eligibility.js';
import {
	referenceCodes,
	referenceRowOf,
	referenceTables,
	type ReferenceRow,
	type TableLookup
} from '../../../lib/expressions/functions/tables.js';
import type { ReferenceTable } from '../../../lib/datatypes/reference_tables.js';
import { worksiteOn } from '../../../data/collection/worksites/lib/in-force.js';
import { resolvePersonFacts } from '../../../lib/person-facts.js';
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
import { coversDate, effectiveOn, live, overlapsRange, readRange } from './effective.js';
import {
	composeOverlay,
	overlayInForce,
	overlayTables,
	settingsInForce,
	type LineageOverlay,
	type OverlayHit
} from '../../../lib/jurisdiction_settings.js';
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
 * - `DERIVED_DAY`      — a day's pay a band posts to its own `line`: priced like overtime, but not
 *                        overtime in law and not the salary (read as `DAY_PAY`).
 * - `ABSENCE`          — unexplained absence, priced from the day wage.
 */
export type ComponentDefinition =
	| { readonly source: 'ENTRY' }
	| { readonly source: 'SCHEDULE'; readonly unit: 'MONEY'; readonly reducible: boolean }
	| { readonly source: 'RESULTS_FLOOR'; readonly unit: 'MONEY' }
	| { readonly source: 'DERIVED_OVERTIME'; readonly unit: 'MONEY' }
	| { readonly source: 'DERIVED_NORMAL'; readonly unit: 'MONEY' }
	| { readonly source: 'DERIVED_DAY'; readonly unit: 'MONEY' }
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
type Worksite = WorkspaceRow<'worksites'>;
type StoredReferenceRow = ReferenceRow & { readonly settings_id: unknown };

/** What one day of an employment reads that a locality overlay can replace (`atWorksite`). */
export type DayConfiguration = Pick<
	Configuration,
	| 'jurisdiction'
	| 'work'
	| 'holidayRestPrecedence'
	| 'lastRestDayOnly'
	| 'limits'
	| 'breaks'
	| 'nightPremium'
	| 'catalogueLeaves'
>;

/** The rows the base version's overlays (`jurisdiction.overlays`) read; absent where it declares none. */
export type OverlaySource = {
	/** The day the run picked its version on; an employment's top-level fields are this day's. */
	readonly asOf: IsoDate;
	readonly declarations: readonly LineageOverlay[];
	/** Every live version of the declared overlay lineages. */
	readonly versions: readonly Jurisdiction[];
	/** Each overlay version's own leave rows, which replace the base's by code. */
	readonly leaves: ReadonlyMap<string, readonly CatalogueLeave[]>;
};
export type ContributionRule = WorkspaceRow<'statutory_contributions'>['rules'][number];
type StatutoryContribution = WorkspaceRow<'statutory_contributions'>;

/** One statutory scheme with the rules that were in force when the run was picked. */
export type ContributionConfig = {
	readonly row: StatutoryContribution;
	readonly rules: readonly ContributionRule[];
};

export type Configuration = {
	readonly company: Company & { readonly [DATED]?: DatedCompany };
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
	/** The company's worksite revisions, so an employment's days are placed (`atWorksite`). */
	readonly worksites: readonly Worksite[];
	/** Every live reference row, by the version that owns it. */
	readonly referenceRows: ReadonlyMap<string, readonly StoredReferenceRow[]>;
	readonly overlay?: OverlaySource | undefined;
	/**
	 * One day as this employment reads it, set by `atWorksite` where the version declares overlays:
	 * a day at a routed worksite reads the overlay's work rules and leave rows; others the base's.
	 */
	readonly onDay?: ((day: IsoDate) => DayConfiguration) | undefined;
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
	const referenceRows = Map.groupBy(
		live(world.reference_rows ?? []).map(referenceRowOf) as StoredReferenceRow[],
		(row) => String(row.settings_id)
	);
	const worksites = live(world.worksites ?? []).filter((row) => row.company_id === company.id);
	const declarations = (jurisdiction.overlays ?? []) as readonly LineageOverlay[];
	const overlayCodes = new Set(declarations.map((overlay) => overlay.lineage));
	const overlayVersions = live(world.jurisdiction_settings).filter((row) =>
		overlayCodes.has(row.code)
	);
	const holidayRows = ofCompany(world.jurisdiction_holidays, company.id).filter((row) => {
		const day = dateKey(row.date);
		return row.published_at != null && day >= windowStart && day <= windowEnd;
	});
	const resolvedCalendar = resolveHolidayInputs(
		holidayRows,
		company.id,
		daysBetween(windowStart, windowEnd)
	);
	// The revisions' evidence: the keys a rule relying on an evidenced entity fact reads.
	const evidenced = Map.groupBy(
		live(world.fact_evidence ?? []).filter((row) => row.subject.collection === 'company_facts'),
		(row) => String(row.subject.id)
	);
	const revisions = companyFactRevisions.map((row) => ({
		facts: row.facts ?? {},
		effective_range: row.effective_range,
		evidence_keys: (evidenced.get(row.id) ?? []).map((evidence) => evidence.fact_key)
	}));

	return {
		recordedCompanyFacts: company.facts ?? {},
		companyFactRevisions: revisions,
		company: {
			...company,
			// The revision in force on the run's governing date prices the whole run; the current
			// company row remains the standing record when no revision covers it.
			facts: resolveCompanyFacts(jurisdiction.facts ?? [], company, { asOf, revisions }),
			[DATED]: datedCompany(versionRows, code, referenceRows, worksites)
		},
		jurisdiction,
		lineageVersions: versionRows,
		...work,
		contributions: prepareContributionCatalogue(world, jurisdiction.id),
		catalogueLeaves: prepareLeaveCatalogue(world, jurisdiction.id),
		allowanceCodeById: money.allowanceCodeById,
		worksites,
		referenceRows,
		overlay:
			declarations.length === 0
				? undefined
				: {
						asOf,
						declarations,
						versions: overlayVersions,
						leaves: new Map(
							overlayVersions.map((row) => [row.id, prepareLeaveCatalogue(world, row.id)])
						)
					},
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

/**
 * What the entity's person contexts read on their own dates: the lineage's table rows through the
 * version in force (`table()`), and the revision of a named worksite in force (`worksite.*`).
 */
function datedCompany(
	versions: readonly WorkspaceRow<'jurisdiction_settings'>[],
	code: string,
	rows: ReadonlyMap<string, readonly StoredReferenceRow[]>,
	sites: readonly Worksite[]
): DatedCompany {
	const lookups = new Map<string, TableLookup | undefined>();
	return {
		tables: (asOf) => {
			if (lookups.has(asOf)) return lookups.get(asOf);
			const version = settingsInForce(versions, code, asOf);
			const declared = (version?.tables ?? []) as readonly ReferenceTable[];
			const lookup =
				version == null || declared.length === 0
					? undefined
					: referenceTables(declared, rows.get(version.id) ?? [])(asOf);
			lookups.set(asOf, lookup);
			return lookup;
		},
		worksite: (id, asOf) => {
			const revision = worksiteOn(sites, id, asOf);
			if (revision == null)
				refuse(
					`Worksite ${sites.find((row) => row.id === id)?.code ?? id} has no revision in force on ${asOf}.`
				);
			return revision;
		}
	};
}

/**
 * The run's world with each person's dated facts (`employee.facts.*`) bound to their employee row:
 * the revision in force on a context's date, an employment's row over the personal one, against the
 * version in force that day. A lineage that declares no person facts leaves the world as read.
 */
export function withDatedPeople(configuration: Configuration, world: PayrollWorld): PayrollWorld {
	const code = configuration.jurisdiction.code;
	const versions = configuration.lineageVersions;
	if (!versions.some((version) => (version.person_facts ?? []).length > 0)) return world;
	const rowsByEmployee = Map.groupBy(live(world.person_facts ?? []), (row) =>
		String(row.employee_id)
	);
	return {
		...world,
		employees: world.employees.map((employee) => {
			const rows = (rowsByEmployee.get(employee.id) ?? []).map((row) => ({
				...row,
				employment_id: row.employment_id == null ? null : String(row.employment_id)
			}));
			const resolved = new Map<string, ReturnType<NonNullable<DatedEmployee['facts']>>>();
			const dated: DatedEmployee = {
				facts: (asOf, employmentId) => {
					const key = `${asOf}:${employmentId ?? ''}`;
					const known = resolved.get(key);
					if (known != null) return known;
					const fields = (settingsInForce(versions, code, asOf)?.person_facts ??
						[]) as readonly FactKey[];
					const facts = resolvePersonFacts(fields, rows, {
						asOf: asOf as IsoDate,
						employmentId: employmentId ?? '',
						scope: `${employee.name}: person facts on ${asOf}`
					});
					resolved.set(key, facts);
					return facts;
				}
			};
			return { ...employee, [DATED]: dated };
		})
	};
}

/**
 * The run's world with the entity's recorded terms and work-day inputs judged and resolved, each
 * against the version governing its date: a terms row on the first day it prices in the salary
 * window (else its own first day), a person-day on its date. Inside the run's windows a required
 * value must be present and a value whose declaration demands evidence must have its
 * `fact_evidence` row; every row gets its declared defaults, and its recorded keys as `fact_keys`
 * (`terms.fact_keys`, `day_fact_keys`). A lineage that declares neither schema leaves the world as read.
 */
export function withDeclaredFacts(
	configuration: Configuration,
	world: PayrollWorld,
	window: PayrollWindow
): PayrollWorld {
	const code = configuration.jurisdiction.code;
	const versions = configuration.lineageVersions;
	const declared = (day: string, schema: 'terms_facts' | 'work_day_facts') =>
		((settingsInForce(versions, code, day) ?? configuration.jurisdiction)[schema] ??
			[]) as readonly FactKey[];
	if (
		!versions.some(
			(version) =>
				(version.terms_facts ?? []).length > 0 || (version.work_day_facts ?? []).length > 0
		)
	)
		return world;
	const evidence = new Set(
		live(world.fact_evidence ?? []).map(
			(row) => `${row.subject.collection}:${row.subject.id}:${row.fact_key}`
		)
	);
	// A `code` input names a row of its table in force on the day, under its parent's code.
	const tableRows = Map.groupBy(live(world.reference_rows ?? []).map(referenceRowOf), (row) =>
		String(row.settings_id)
	);
	const codesOn = (day: string) =>
		referenceCodes(
			tableRows.get((settingsInForce(versions, code, day) ?? configuration.jurisdiction).id) ?? [],
			day
		);
	const employments = new Map(
		live(world.employments)
			.filter((row) => row.company_id === configuration.company.id)
			.map((row) => [row.id, row])
	);
	const employees = new Map(live(world.employees).map((row) => [row.id, row]));
	const termsByEmployment = Map.groupBy(live(world.employment_terms), (row) => row.employment_id);
	const judge = <R extends { readonly id: string; readonly facts?: unknown }>(
		collection: 'employment_terms' | 'work_days',
		row: R,
		employmentId: WorkspaceRow<'employments'>['id'],
		day: string,
		inWindow: boolean
	): R => {
		const employment = employments.get(employmentId)!;
		const fields = declared(
			day,
			collection === 'employment_terms' ? 'terms_facts' : 'work_day_facts'
		);
		const raw = scalarFacts(row.facts as Readonly<Record<string, unknown>> | null | undefined);
		const scope = `${employment.employee_number}: ${collection === 'employment_terms' ? 'terms' : 'work day'} on ${day}`;
		if (inWindow) {
			let person: PersonContext | undefined;
			const range = readRange(employment.effective_range);
			const when = (expression: string) =>
				isEligible(
					expression,
					(person ??= personContext({
						employee: employees.get(employment.employee_id) ?? null,
						employment: {
							service_start: dateKey(range?.start),
							exit_date: range?.end == null ? null : dateKey(range.end),
							exit_ground: employment.exit_ground
						},
						terms:
							(termsByEmployment.get(employmentId) ?? []).find((terms) =>
								coversDate(terms.effective_range, day)
							) ?? null,
						company: configuration.company,
						asOf: day
					}))
				);
			requireFactValues(
				fields,
				raw,
				scope,
				when,
				(key) => evidence.has(`${collection}:${row.id}:${key}`),
				codesOn(day)
			);
		}
		return {
			...row,
			facts: resolveFactValues(fields, raw, scope, false),
			fact_keys: Object.keys(raw)
		};
	};
	const { salary, attendance } = window;
	return {
		...world,
		employment_terms: world.employment_terms.map((row) => {
			if (!employments.has(row.employment_id)) return row;
			const start = dateKey(readRange(row.effective_range)?.start);
			const inWindow = overlapsRange(row.effective_range, salary.start, salary.end);
			const day = inWindow && start < salary.start ? salary.start : start;
			return judge('employment_terms', row, row.employment_id, day, inWindow);
		}),
		work_days: world.work_days.map((row) => {
			if (!employments.has(row.employment_id)) return row;
			const day = dateKey(row.work_date);
			return judge(
				'work_days',
				row,
				row.employment_id,
				day,
				day >= attendance.start && day <= attendance.end
			);
		})
	};
}

/**
 * The configuration as one employment observes it, day by day, at the worksite each date places it
 * (a work day's own worksite over its terms'):
 *
 * - the company's holidays plus the local days of that worksite (PH RA 12271, Navotas): a local row
 *   names the terms' recorded worksite text or the worksite revision's region;
 * - where the version declares overlays, a day whose `when` holds reads the overlay version's work
 *   rules, leave rows and tables (`onDay`, and `table()` through the company's dated inputs). The
 *   top-level fields are the run's pick day's; schemes are always the base's.
 *
 * Unchanged when no row is local and nothing is overlaid.
 */
export function atWorksite<T extends Configuration>(
	configuration: T,
	terms: readonly WorkspaceRow<'employment_terms'>[],
	workDays: readonly Pick<WorkspaceRow<'work_days'>, 'work_date' | 'worksite_id'>[] = []
): T {
	const overlay = configuration.overlay;
	const local = configuration.holidayRows.some((row) => row.worksite?.trim());
	if (overlay == null && !local) return configuration;
	const termsOn = (date: string) => terms.find((term) => coversDate(term.effective_range, date));
	const dayWorksite = new Map(
		workDays.flatMap((day) =>
			day.worksite_id == null ? [] : [[dateKey(day.work_date), String(day.worksite_id)] as const]
		)
	);
	const siteOn = (date: string) => {
		const id = dayWorksite.get(date) ?? termsOn(date)?.worksite_id;
		return id == null ? null : worksiteOn(configuration.worksites, id, date);
	};
	const holidays = local
		? resolveHolidays(
				configuration.holidayRows,
				configuration.company.id,
				configuration.holidayWindow.start,
				configuration.holidayWindow.end,
				(date) => termsOn(date)?.worksite?.trim() || siteOn(date)?.region?.trim() || undefined
			)
		: configuration.holidays;
	if (overlay == null) return { ...configuration, holidays };

	// ponytail: one CEL evaluation per employment-day; memoise by worksite revision if a large
	// roster makes it show in the run profile.
	const hits = new Map<string, OverlayHit<Jurisdiction> | null>();
	const hitOn = (date: string) => {
		if (hits.has(date)) return hits.get(date)!;
		const row = termsOn(date);
		const site = siteOn(date);
		const person =
			row == null
				? null
				: personContext({
						employee: null,
						employment: { service_start: '', exit_date: null },
						// the day's placed worksite, or none: an unplaced day reads an empty `worksite.*`
						terms: { ...row, worksite_id: site == null ? null : String(site.id) },
						company: configuration.company,
						asOf: date
					});
		const hit =
			person == null
				? null
				: overlayInForce(overlay.declarations, overlay.versions, date, (when) =>
						isEligible(when, person)
					);
		hits.set(date, hit);
		return hit;
	};
	const base: DayConfiguration = {
		jurisdiction: configuration.jurisdiction,
		work: configuration.work,
		holidayRestPrecedence: configuration.holidayRestPrecedence,
		lastRestDayOnly: configuration.lastRestDayOnly,
		limits: configuration.limits,
		breaks: configuration.breaks,
		nightPremium: configuration.nightPremium,
		catalogueLeaves: configuration.catalogueLeaves
	};
	const views = new Map<string, DayConfiguration>();
	const onDay = (date: IsoDate): DayConfiguration => {
		const hit = hitOn(date);
		if (hit == null) return base;
		const known = views.get(hit.version.id);
		if (known != null) return known;
		const jurisdiction = composeOverlay(configuration.jurisdiction, hit);
		const leaves = overlay.leaves.get(hit.version.id) ?? [];
		const replaced = new Set(leaves.map((row) => row.code));
		const view: DayConfiguration = {
			jurisdiction,
			...prepareWorkCatalogue(jurisdiction),
			catalogueLeaves: [
				...configuration.catalogueLeaves.filter((row) => !replaced.has(row.code)),
				...leaves
			]
		};
		views.set(hit.version.id, view);
		return view;
	};
	// `table()` on an overlay day: the base version in force's tables, those the overlay declares replaced.
	const dated = configuration.company[DATED];
	const lookups = new Map<string, TableLookup | undefined>();
	const tables = (asOf: string): TableLookup | undefined => {
		const hit = hitOn(asOf);
		if (hit == null || dated == null) return dated?.tables(asOf);
		if (lookups.has(asOf)) return lookups.get(asOf);
		const version =
			settingsInForce(configuration.lineageVersions, configuration.jurisdiction.code, asOf) ??
			configuration.jurisdiction;
		const own = (hit.version.tables ?? []) as readonly ReferenceTable[];
		const replaced = new Set(own.map((table) => table.name));
		const declared = overlayTables((version.tables ?? []) as readonly ReferenceTable[], own);
		const rows = [
			...(configuration.referenceRows.get(version.id) ?? []).filter(
				(row) => !replaced.has(row.table)
			),
			...(configuration.referenceRows.get(hit.version.id) ?? [])
		];
		const lookup = declared.length === 0 ? undefined : referenceTables(declared, rows)(asOf);
		lookups.set(asOf, lookup);
		return lookup;
	};
	return {
		...configuration,
		...onDay(overlay.asOf),
		holidays,
		onDay,
		company:
			dated == null
				? configuration.company
				: { ...configuration.company, [DATED]: { ...dated, tables } }
	};
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
		// The overlay versions a day can route to govern its arithmetic like the base does.
		...(configuration.overlay == null
			? {}
			: {
					overlays: configuration.overlay.versions
						.map((row) => [row.code, row.id, row.effective_range])
						.toSorted((left, right) => String(left[1]).localeCompare(String(right[1])))
				}),
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
