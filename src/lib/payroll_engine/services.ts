import { Effect, Option, Result, Schema } from 'effect';
import { fromAbsolute, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
import { addDays, addMonths, datePeriod, days, intersect, monthOf } from '@norbital-ai/std/date';
import { type Behaviours, planBehaviours } from './behaviours.js';
import { statutoryFactsFromFacts } from './employment_facts.js';
import { evaluateConfigured } from './expressions.js';
import type { Id, TransformCtx } from '@norbital-ai/bolt';
import {
	type DynObject,
	type HostRow,
	type JoinedMember,
	type Json,
	type JsonObject,
	completedMonths,
	isDynObject,
	isJsonObject,
	plainRows,
	readAll,
	readJoined,
	readJoinedSet,
	readKeyed,
	eachBatched,
	type Selection,
	moneyNumber,
	numberOf,
	PAYROLL_TIME_ZONE,
	payPeriodWindow,
	plain,
	Refusal,
	runEngine,
	stableJson,
	weeklyInstalments,
	workspaceReadAsHost,
	type FrequencyChange,
	frequencyOn,
	frequencySpans,
	periodsIn
} from './foundation.js';
import {
	type AttendanceDay,
	classFromRow,
	coverageRange,
	dayKey,
	eventIdOf,
	movementFromRow,
	chainStarts,
	movementsByCode,
	readsAttendance,
	refuseLeaveWrite,
	serviceMonthsAt
} from './leave.js';
import { type PlannedShift, plannedShift, plannedShiftId } from './shift_pattern.js';

/**
 * The payroll engine: aggregate the records in force → order the run's lines (work, allowances, entries, statutory)
 * → evaluate each line from its catalogue row → the payslips. Every amount, classification and statutory charge is
 * a CEL expression or a list held on a seeded record; this module only reads, orders, sums and refuses.
 */

const round2 = (value: number): number => Math.round(value * 100 + Number.EPSILON) / 100;

/** A currency's minor units (ISO 4217 exponent, as the runtime's currency data holds it): JPY 0, SGD 2. */
export const currencyScale = (currency: string): number => {
	try {
		return (
			new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
				.maximumFractionDigits ?? 2
		);
	} catch {
		return 2;
	}
};

/** The first month (`YYYY-MM`) of the year holding `month`, for a year starting in `startMonth` (1–12). */
const taxYearStart = (month: string, startMonth = 1): string => {
	const start = Math.min(12, Math.max(1, Math.trunc(startMonth)));
	const year = Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < start ? 1 : 0);
	return `${year}-${String(start).padStart(2, '0')}`;
};

/** The zone an entity's days and clocks are counted in: its own, else its version's `payroll.timezone`. */
const zoneOf = (entity: Pick<EntityRow, 'time_zone'>, version: SettingsRow | undefined): string =>
	entity.time_zone ?? version?.payroll?.timezone ?? PAYROLL_TIME_ZONE;

/** Half-up rounding to `scale` decimals: the money of one payroll currency. */
const roundTo =
	(scale: number) =>
	(value: number): number => {
		const unit = 10 ** scale;
		return Math.round(value * unit + Number.EPSILON) / unit;
	};

const num = (value: unknown, fallback = 0): number => numberOf(value) ?? fallback;

// ponytail: `hours.months` and `earned.months` reach 12 months back; a longer window (TW 24-month leave) needs more.
const HISTORY_MONTHS = 12;
/** `earned.history` reaches 24 months back: a benefit averaged over the 12–18 months before a contingency. */
const LONG_HISTORY_MONTHS = 24;

const dayInRange = (day: string, range: CalendarRange): boolean =>
	(range.from == null || day >= range.from) && (range.to == null || day <= range.to);

export type PayrollFrequency =
	'MONTHLY' | 'SEMI_MONTHLY' | 'TEN_DAY' | 'WEEKLY' | 'DAILY' | 'INTEGER_MONTHS';
export type PayrollRunKind = 'REGULAR' | 'OFF_CYCLE';
/** Salary runs pay the contract; settlement runs pay only their selected entries. */
export const SALARY_RUNS: readonly PayrollRunKind[] = ['REGULAR'];
const isSalaryRun = (kind: unknown): boolean => SALARY_RUNS.some((allowed) => allowed === kind);

export type PayrollRunRequest = {
	readonly company_id: string;
	readonly period: string;
	readonly kind: PayrollRunKind;
	readonly sources?: readonly string[];
	readonly pay_due_date?: string;
	/** The run being built, when it is already stored: it is not its own duplicate. */
	readonly run_id?: string;
};

/** The entry and roster collections a payslip consumes; the run pins each consumed row to its payslip. */
export type PinnedCollection =
	| 'adhoc_catalog_entry'
	| 'claim_catalog_entry'
	| 'leave_catalog_entry'
	| 'loan_catalog_entry'
	| 'roster_entry';

export type PayslipLine = {
	readonly family: string;
	readonly source_id: string;
	readonly component_code: string;
	readonly bucket: 'EARNING' | 'DEDUCTION';
	/** PAY lines move gross; NET lines are paid or recovered after statutory. */
	readonly destination: 'PAY' | 'NET';
	readonly amount: number;
	readonly label?: string;
};

export type PayslipPlan = {
	readonly employment_id: Id<'employment_contract'>;
	readonly salary_from: string;
	readonly salary_to: string;
	readonly currency: string;
	readonly base: readonly {
		component_code: string;
		label?: string;
		amount: number;
		quantity?: number;
		rate?: number;
	}[];
	readonly adjustments: readonly PayslipLine[];
	readonly statutory: readonly PayslipStatutoryLine[];
	readonly gross: number;
	readonly total_deductions: number;
	readonly net: number;
	readonly employer_cost: number;
	readonly proration: readonly {
		component_code: string;
		from: string;
		to: string;
		days: number;
		denominator: number;
		contract_amount: number;
		prorated_amount: number;
		/** A switched month's line, settled month to date: its window opens on the 1st and it holds the month's total. */
		window_from?: string;
	}[];
	readonly service_basis: readonly {
		from: string;
		to: string;
		days: number;
		denominator: number;
	}[];
	readonly pins: readonly { readonly collection: PinnedCollection; readonly id: string }[];
	/** What the records flagged on this slip (`warn`, `warn_when`), each named by the person. */
	readonly warnings: readonly string[];
	/** Why a `hold` validation stops this slip: the run's `pin`-time behaviour puts it ON_HOLD. */
	readonly hold: string | null;
};

export type PayrollPlan = {
	readonly run: {
		readonly company_id: string;
		readonly settings_id: Id<'jurisdiction_settings'>;
		readonly period: string;
		readonly kind: PayrollRunKind;
		readonly sources: readonly string[];
		readonly configuration_hash: string;
		readonly pay_date: string;
		readonly pay_due_date: string;
		readonly salary_from: string;
		readonly salary_to: string;
		readonly attendance_from: string;
		readonly attendance_to: string;
	};
	readonly payslips: readonly PayslipPlan[];
	readonly warnings: readonly string[];
};

export interface CalendarRange {
	readonly from?: string | null;
	readonly to?: string | null;
}

/** One scheme's stored configuration: CEL over the month's assessed wage. */
export interface StatutoryRule {
	readonly when?: string;
	readonly employee?: string;
	readonly employer?: string;
	readonly contribution?: string;
}

export interface StatutoryConfiguration {
	/** Person facts the scheme reads (its age basis), CEL merged into `person`. */
	readonly person?: { readonly [fact: string]: string };
	/** Each wage part's month-to-date assessable amount (ceilings, projections); an absent part is assessed as paid. */
	readonly assessable?: { readonly [part: string]: string };
	readonly assessment?: string;
	readonly rules?: readonly StatutoryRule[];
	readonly refuse_when?: readonly { readonly when: string; readonly message: string }[];
	/** Like `refuse_when`, but the slip is paid and the message lands in the run's warnings. */
	readonly warn_when?: readonly { readonly when: string; readonly message: string }[];
	readonly limitation?: string;
	/** Evaluate the scheme on a salary slip even when the month paid it no wage (a premium on the contractual base). */
	readonly assess_without_wage?: boolean;
	/** `pay_date`: the scheme is assessed under the version governing the run's pay day, not its period start. */
	readonly governed_by?: string;
	/** The employee share a slip's net cannot cover is advanced on it and recovered from the next slips' net. */
	readonly carry_uncovered?: boolean;
	/** Where the scheme is assessed among the others (lower first); absent, after every ordered one, by code. */
	readonly order?: number;
	/** The day the scheme reads its subject on: `period_start` (default), `period_end` or `pay_date`. */
	readonly as_of?: string;
}

export interface StatutoryRow {
	readonly id: string;
	readonly code: string;
	readonly configuration?: StatutoryConfiguration;
}

export interface SettingsRow {
	readonly id: Id<'jurisdiction_settings'>;
	readonly code: string;
	readonly payroll?: {
		readonly currency?: string;
		/** Decimals money is kept to; absent, the currency's ISO 4217 minor units. */
		readonly minor_units?: number;
		/** The zone local days and clocks are counted in when the entity names none. */
		readonly timezone?: string;
		/** The month the year roots (`earned.year`, `hours.year`, statutory `year` and `charged`) start in. */
		readonly tax_year_start_month?: number;
		/** The months `hours.rolling` sums, this one included (default 3). */
		readonly rolling_hours_months?: number;
		/** CEL on `period` and `company`: the run's pay day when the request names none (default `period.to`). */
		readonly pay_date?: string;
		/** The day a week starts (0 = Sunday … 6): `WEEKLY` periods and a `CALENDAR` roster week (default Sunday). */
		readonly week_start?: number;
		/** A `SEMI_MONTHLY` first half's last day (default 15). */
		readonly semi_monthly_split?: number;
		/** The roster checks' `week`: `ROLLING` (the 7 days ending on the day, default) or `CALENDAR` (from week_start). */
		readonly roster_week?: 'ROLLING' | 'CALENDAR';
		/** Whether a salary slip refuses a contract with no base salary (default true). */
		readonly base_salary_required?: boolean;
		/** The entry families an off-cycle run may select (default `ADHOC`, `CLAIM`). */
		readonly off_cycle_families?: readonly string[];
		/** CEL on `terms`: the subject's `terms.monthly_wage` (default base salary plus every fixed allowance). */
		readonly monthly_wage?: string;
		/** `refuse` (default) or `allow` a slip whose net pay is negative. */
		readonly negative_net?: 'refuse' | 'allow';
	};
	readonly behaviours?: Behaviours;
	readonly effective_range?: CalendarRange;
	readonly sealed_at?: string | null;
	readonly voided_at?: string | null;
	readonly approval_id?: string | null;
}
export interface EntityRow {
	readonly id: string;
	readonly name?: string;
	readonly settings_code: string;
	readonly pay_cutoff_day?: number;
	readonly pay_frequency?: PayrollFrequency;
	readonly pay_frequency_changes?: readonly FrequencyChange[] | null;
	readonly region?: string | null;
	readonly risk_class?: string | null;
	readonly time_zone?: string | null;
	readonly facts?: { readonly [key: string]: unknown } | null;
}

/** A catalogue row the engine prices a line from: its class, its sign and the schemes it counts toward. */
export interface CatalogRow {
	readonly id: string;
	readonly code: string;
	readonly name?: string;
	readonly destination?: 'PAY' | 'NET' | 'EMPLOYER' | 'DISPLAY';
	readonly direction?: 'ADD' | 'SUBTRACT';
	readonly counts_toward?: readonly string[];
	readonly eligibility?: string;
	readonly qualifies_when?: string;
	readonly bands?: readonly {
		readonly when?: string;
		readonly amount: string;
		readonly limit?: {
			readonly amount?: string;
			readonly on_exceed?: string;
			/** The span the limit meters: `ENTRY` (default, each claim alone), `PERIOD` (the run's settlement period) or
			 * `CALENDAR_YEAR`, less the claims of the class already taken in it. */
			readonly window?: string;
		} | null;
	}[];
	readonly is_npl?: boolean;
	readonly can_encash?: boolean;
	readonly component_code?: string;
	readonly quantity?: string;
	readonly rate?: string;
	readonly amount?: string;
	readonly prorated?: boolean;
	readonly pay_fraction?: string;
	/** An ad hoc class whose entries may fall after the employment ends (`adhoc_catalog.payable_after_exit`). */
	readonly payable_after_exit?: boolean;
	/** An ad hoc class the final slip raises itself when its eligibility holds (`adhoc_catalog.raise_on_exit`). */
	readonly raise_on_exit?: boolean;
	/** A leave class's share of a row across periods: `WORKING_DAYS` (default) or `CALENDAR_DAYS`. */
	readonly share_by?: string;
	/** A prorated work line's stated divisor (CEL; default the period's calendar days). */
	readonly denominator?: string;
	/** Whether an entry of the class must carry an amount (default true): a band-priced class need not. */
	readonly amount_required?: boolean;
}

export interface ContractAllowance {
	readonly catalogue_id?: string;
	readonly code?: string;
	readonly amount?: { readonly value?: number } | number;
}

export interface ContractTerm {
	readonly base_salary?: { readonly value?: number; readonly currency?: string };
	readonly effective_range?: CalendarRange;
	readonly allowances?: readonly ContractAllowance[];
	readonly residency_status?: string;
	readonly residency_since?: string;
	readonly work_classification?: string;
	readonly statutory_work_category?: string;
	readonly employment_type?: string;
	readonly shift_pattern_id?: string;
	readonly facts?: { readonly [key: string]: unknown };
}

export interface ContractRow {
	readonly id: Id<'employment_contract'>;
	readonly employee_id: string;
	readonly company_id: string;
	readonly effective_range?: CalendarRange;
	readonly prior_service_months?: number;
	/** `PAYEE`: paid through entries only, outside the headcount (a non-employee payee). */
	readonly engagement?: string | null;
	readonly exit_ground?: string | null;
	readonly exit_facts?: { readonly [key: string]: unknown } | null;
	readonly facts?: { readonly contract_terms?: readonly ContractTerm[] };
}

export interface EmployeeRow {
	readonly id: string;
	readonly name?: string;
	readonly date_of_birth?: string;
	readonly nationality?: string;
	readonly race?: string;
	readonly religion?: string;
	readonly gender?: string | null;
	readonly marital_status?: string | null;
	readonly spouse_status?: string | null;
	readonly solo_parent?: boolean | null;
	readonly disabled?: boolean | null;
	readonly receiving_pension?: boolean | null;
	readonly children?: unknown;
	readonly dependents_count?: number | null;
	readonly facts?: { readonly [key: string]: unknown } | null;
}

/** An entry family's own columns; `facts` is the one open bag, merged last into the rule context. */
export interface EntryColumns {
	readonly amount?: unknown;
	readonly quantity?: number | null | undefined;
	readonly days?: number | null | undefined;
	readonly from?: string | null | undefined;
	readonly to?: string | null | undefined;
	readonly incurred_on?: string | null | undefined;
	readonly due_on?: string | null | undefined;
	readonly label?: string | null | undefined;
	readonly facts?: unknown;
}

export interface EntryRow extends EntryColumns {
	readonly id: string;
	readonly catalog_id?: string;
	readonly employment_id?: string;
	readonly reference?: string;
	readonly occurred_on?: string;
	readonly activity?: string;
	readonly approval_id?: string | null;
	readonly payslip_id?: string | null;
}

/** Stored rows and transform inputs: only fields `transformEntries` reads, excess keys stripped. */
const LooseEntryRowSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	catalog_id: Schema.optional(Schema.String),
	employment_id: Schema.optional(Schema.String),
	occurred_on: Schema.optional(Schema.String),
	activity: Schema.optional(Schema.String),
	amount: Schema.optional(Schema.NullOr(Schema.Unknown)),
	quantity: Schema.optional(Schema.NullOr(Schema.Number)),
	days: Schema.optional(Schema.NullOr(Schema.Number)),
	from: Schema.optional(Schema.NullOr(Schema.String)),
	to: Schema.optional(Schema.NullOr(Schema.String)),
	incurred_on: Schema.optional(Schema.NullOr(Schema.String)),
	due_on: Schema.optional(Schema.NullOr(Schema.String)),
	label: Schema.optional(Schema.NullOr(Schema.String)),
	reference: Schema.optional(Schema.NullOr(Schema.String)),
	facts: Schema.optional(Schema.NullOr(Schema.Unknown)),
	approval_id: Schema.optional(Schema.NullOr(Schema.String)),
	payslip_id: Schema.optional(Schema.NullOr(Schema.String))
});
type LooseEntryRow = Schema.Schema.Type<typeof LooseEntryRowSchema>;

/** A transform's stored row carries its decimal columns as `Decimal`s: they are read as numbers. */
const entryRow = (value: unknown): LooseEntryRow => {
	if (value == null) return {};
	const held = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value);
	const number = (key: 'days' | 'quantity') =>
		held[key] == null ? {} : { [key]: moneyNumber(held[key]) };
	return Schema.decodeUnknownSync(LooseEntryRowSchema)({
		...held,
		...number('days'),
		...number('quantity')
	});
};

const ENTRY_COLUMNS = ['quantity', 'days', 'from', 'to', 'incurred_on', 'due_on', 'label'] as const;

/** An entry's own columns as the CEL `entry` context: the family's columns, then its open `facts`, then the defaults. */
const entryContext = (row: EntryColumns, occurred_on: string): DynObject => {
	const typed: { [key: string]: Json } = {};
	for (const key of ENTRY_COLUMNS) {
		const value = row[key];
		if (value != null) typed[key] = value;
	}
	const facts = isDynObject(row.facts) ? row.facts : {};
	return {
		...typed,
		...facts,
		amount: moneyNumber(row.amount) ?? 0,
		quantity: num(row.quantity, 1),
		occurred_on,
		due_on: row.due_on ?? occurred_on,
		incurred_on: row.incurred_on ?? occurred_on,
		facts
	};
};

/** An entry row as an earlier sibling of the one being priced: its class code beside its own columns. */
type EarlierRow = EntryRow & { readonly code: string };

/**
 * The CEL root `earlier`: the employment's entries of the same class code before this one (by day, then id) — `rows`
 * (each its columns and open facts), and the signed amounts of the calendar year and of the employment. A class caps
 * per key (a child, an event) by filtering `rows` on its facts.
 */
const earlierContext = (
	siblings: readonly EarlierRow[],
	entry: { readonly id?: string; readonly code: string; readonly occurred_on: string }
): DynObject => {
	const before = siblings.filter(
		(row) =>
			row.code === entry.code &&
			row.id !== entry.id &&
			(String(row.occurred_on ?? '') < entry.occurred_on ||
				(String(row.occurred_on ?? '') === entry.occurred_on && row.id < String(entry.id ?? '')))
	);
	const signed = (row: EarlierRow) =>
		(row.activity === 'REVERSAL' ? -1 : 1) * (moneyNumber(row.amount) ?? 0);
	const sum = (rows: readonly EarlierRow[]) =>
		round2(rows.reduce((total, row) => total + signed(row), 0));
	return {
		rows: before.map((row): JsonObject => {
			const facts = isJsonObject(row.facts) ? row.facts : {};
			return {
				...facts,
				facts,
				id: row.id,
				code: row.code,
				activity: row.activity ?? '',
				amount: moneyNumber(row.amount) ?? 0,
				occurred_on: String(row.occurred_on ?? '')
			};
		}),
		calendar_year: sum(
			before.filter(
				(row) => String(row.occurred_on ?? '').slice(0, 4) === entry.occurred_on.slice(0, 4)
			)
		),
		lifetime: sum(before)
	};
};

/** The signed amounts of `earlier.rows` falling in `from`–`to`: what a class already took in a limit's window. */
const earlierSum = (rows: readonly JsonObject[], from: string, to: string): number =>
	round2(
		rows
			.filter((row) => String(row['occurred_on']) >= from && String(row['occurred_on']) <= to)
			.reduce(
				(total, row) => total + (row['activity'] === 'REVERSAL' ? -1 : 1) * num(row['amount']),
				0
			)
	);

/** Every entry of one family for the employments (any state of payment), each with its class code. */
const familySiblings = (collection: EntryCollection, employments: readonly string[]) =>
	Effect.gen(function* () {
		const family = FAMILIES.find((candidate) => candidate.collection === collection)!;
		const rows =
			employments.length === 0
				? []
				: yield* readAll<EntryRow>(
						collection,
						{ employment_id: { in: [...employments] }, approval_id: { isNull: true } },
						undefined,
						ENTRY[collection]
					);
		const ids = [...new Set(rows.map((row) => row.catalog_id).filter((id) => id != null))];
		const codes = new Map(
			(ids.length === 0
				? []
				: yield* readAll<{ id: string; code: string }>(
						family.catalog,
						{ id: { in: ids } },
						undefined,
						pick('id', 'code')
					)
			).map((row) => [row.id, row.code])
		);
		return rows.map((row): EarlierRow => ({
			...row,
			code: codes.get(String(row.catalog_id)) ?? ''
		}));
	});

interface RosterRow {
	readonly id: string;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id?: string | null;
	readonly worked_intervals?: unknown;
	readonly approved_overtime_hours?: number | null;
	/** Of the approved overtime, the hours the employee elected to bank as time off instead of pay. */
	readonly banked_overtime_hours?: number | null;
	/** The overtime band (rate code) the banked hours were earned in, for a payout of those left untaken. */
	readonly banked_overtime_band?: string | null;
	readonly incentive_hours?: number | null;
	/** When the worker consented to the day's overtime (the owner's ruling: consent is per day). */
	readonly overtime_consented_at?: string | null;
	readonly worksite?: string | null;
	readonly facts?: unknown;
	readonly payslip_id?: string | null;
}

/** A work suspension: an entity's blocked-out days of one kind, for a worksite or named employments (else all). */
interface SuspensionRow {
	readonly kind: string;
	readonly starts_on: string;
	readonly ends_on: string;
	readonly worksite?: string | null;
	readonly employment_ids?: unknown;
	readonly facts?: unknown;
}

/** The suspension covering one employment's day: it names the employment, or names none and its worksite (if any)
 * is the day's (the roster's worksite, else the terms' `facts.worksite`). */
const suspensionOn = (
	suspensions: readonly SuspensionRow[],
	employment_id: string,
	date: string,
	worksite: string
): SuspensionRow | undefined =>
	suspensions.find((held) => {
		if (date < held.starts_on || date > held.ends_on) return false;
		const named = Array.isArray(held.employment_ids) ? held.employment_ids : [];
		if (named.length > 0) return named.includes(employment_id);
		return held.worksite == null || held.worksite === '' || held.worksite === worksite;
	});

/** The entity's suspensions overlapping `from`–`to`. */
const suspensionsOf = (company_id: string, from: string, to: string) =>
	readAll<SuspensionRow>(
		'work_suspension',
		{
			company_id: { eq: company_id },
			approval_id: { isNull: true },
			starts_on: { lte: to },
			ends_on: { gte: from }
		},
		undefined,
		pick('kind', 'starts_on', 'ends_on', 'worksite', 'employment_ids', 'facts')
	);

/** A suspension kind: what a suspended day does, as its catalogue row's CEL. */
interface SuspensionKind {
	readonly code: string;
	readonly counts_as_attended?: string | null;
	readonly scheduled?: string | null;
	readonly pay?: string | null;
}

/** A version's suspension catalogue by code. */
const suspensionKinds = (settings_id: string) =>
	readAll<SuspensionKind>(
		'suspension_kind',
		{ settings_id: { eq: settings_id } },
		undefined,
		pick('code', 'counts_as_attended', 'scheduled', 'pay')
	).pipe(Effect.map((rows) => new Map(rows.map((row) => [row.code, row]))));

/** One stored CEL flag of a suspension kind, or its default when the kind leaves it blank. */
const kindFlag = (
	expression: string | null | undefined,
	fallback: boolean,
	context: DynObject,
	where: string
) =>
	expression == null || expression.trim() === ''
		? Effect.succeed(fallback)
		: evaluateBoolean(expression, context, where);

/** A suspended day's attendance effects under its kind: counted as attended (default no), still scheduled (yes). */
const suspendedDay = (kind: SuspensionKind | undefined, context: DynObject) =>
	Effect.gen(function* () {
		const where = `suspension_kind ${kind?.code ?? ''}`;
		return {
			counts_as_attended: yield* kindFlag(kind?.counts_as_attended, false, context, where),
			scheduled: yield* kindFlag(kind?.scheduled, true, context, where)
		};
	});

/** The worksite of a day: the roster's, else the terms in force's `facts.worksite`. */
const worksiteOn = (row: RosterRow | undefined, term: ContractTerm | undefined): string => {
	const fact = term?.facts?.['worksite'];
	return row?.worksite ?? (Schema.is(Schema.String)(fact) ? fact : '');
};

interface ShiftDefinitionRow {
	readonly id: string;
	readonly code?: string;
	readonly variant?: unknown;
}

interface ShiftPatternRow {
	readonly id: string;
	readonly pattern?: unknown;
	readonly effective_range?: CalendarRange;
}

/** A leave movement as the payslip reads its absence event: the event key and the day it covers from. */
interface LeaveEventRow {
	readonly id?: string;
	readonly days?: unknown;
	readonly approval_id?: string | null;
	readonly catalog_id?: string;
	readonly employment_id?: string;
	readonly from?: string | null;
	readonly to?: string | null;
	readonly occurred_on?: string;
	readonly facts?: unknown;
}

interface HolidayRow {
	readonly id: string;
	readonly date: string;
	readonly name?: string | null;
	readonly kind: string;
	readonly published_at?: string | null;
	readonly replaces?: string | null;
	readonly given_to?: string | null;
}

export type PayslipStatutoryLine = {
	readonly scheme_code: string;
	readonly base_amount: number;
	/** The month-to-date assessable amount this slip added, per wage part. */
	readonly parts: { readonly [part: string]: number };
	/** The wage this slip paid toward the scheme, per part, before `assessable`: a later slip's month starts from it. */
	readonly wages?: { readonly [part: string]: number };
	readonly employee_amount: number;
	readonly employer_amount: number;
	/** The base the applied rule charged on (`configuration.assessment`, else the assessed parts), month to date. */
	readonly charged_base?: number;
	readonly rule_when?: string;
};

export interface PayslipHistoryRow {
	readonly id?: string;
	readonly payroll_run_id?: string;
	readonly employment_id?: string;
	readonly status?: string;
	readonly proration?: readonly Partial<PayslipPlan['proration'][number]>[];
	readonly salary_from?: string;
	readonly statutory?: readonly Partial<PayslipStatutoryLine>[];
	readonly base?: readonly { readonly component_code?: string; readonly amount?: unknown }[];
	readonly adjustments?: readonly {
		readonly family?: string;
		readonly source_id?: string;
		readonly component_code?: string;
		readonly destination?: string;
		readonly amount?: unknown;
		readonly label?: string;
	}[];
	readonly gross?: unknown;
	readonly net?: unknown;
}
/** What each read selects: a host read without `select` leaves json fields out, so every engine read names its fields. */
const pick = (...fields: readonly string[]) =>
	Object.fromEntries(fields.map((field) => [field, true as const]));
export const SETTINGS = pick(
	'id',
	'code',
	'approval_id',
	'effective_range',
	'sealed_at',
	'voided_at',
	'payroll',
	'behaviours'
);
const ENTITY = pick(
	'id',
	'name',
	'settings_code',
	'pay_cutoff_day',
	'pay_frequency',
	'pay_frequency_changes',
	'region',
	'risk_class',
	'time_zone',
	'facts'
);
const CONTRACT = pick(
	'id',
	'employee_id',
	'company_id',
	'effective_range',
	'prior_service_months',
	'engagement',
	'exit_ground',
	'exit_facts',
	'facts'
);
const PROFILE = pick(
	'id',
	'name',
	'date_of_birth',
	'nationality',
	'race',
	'religion',
	'gender',
	'marital_status',
	'spouse_status',
	'solo_parent',
	'disabled',
	'receiving_pension',
	'children',
	'dependents_count',
	'facts'
);
/** Each entry family's own columns; `facts` is the one open field, and the rule context is built from both. */
const ENTRY_COMMON = [
	'id',
	'catalog_id',
	'employment_id',
	'company_id',
	'reference',
	'occurred_on',
	'activity',
	'amount',
	'label',
	'facts',
	'payslip_id'
] as const;
/** Each family's own columns beside the common ones: a read naming a column its model lacks is refused. */
const ENTRY = {
	adhoc_catalog_entry: pick(...ENTRY_COMMON, 'quantity'),
	claim_catalog_entry: pick(...ENTRY_COMMON, 'quantity', 'incurred_on', 'due_on'),
	leave_catalog_entry: pick(...ENTRY_COMMON, 'days', 'from', 'to', 'incurred_on'),
	loan_catalog_entry: pick(...ENTRY_COMMON)
} as const;
const STATUTORY = pick('id', 'code', 'configuration');
const RULES = pick('code', 'rules');
/** A version's PAYROLL rule tables, as an arm of the version read: every rule context's `rules`. */
const PAYROLL_RULES = {
	rule_set: { many: pick('family', 'code', 'rules'), where: { family: { eq: 'PAYROLL' } } }
} as const;

/**
 * A version's PAYROLL rule tables by code (`rules`), from its `rule_set` arm (an arm read without `family` is a
 * PAYROLL-only one): `{}` when the read carried none.
 */
export const payrollRules = (version: unknown): { readonly [code: string]: Json } => {
	const listed: unknown = isJsonObject(version) ? version['rule_set'] : undefined;
	return Object.fromEntries(
		(Array.isArray(listed) ? listed : []).flatMap((row: unknown): [string, Json][] => {
			if (!isJsonObject(row) || (row['family'] ?? 'PAYROLL') !== 'PAYROLL') return [];
			const code = row['code'];
			return Schema.is(Schema.String)(code) ? [[code, row['rules'] ?? {}]] : [];
		})
	);
};
const LEAVE_CLASS = pick(
	'id',
	'code',
	'name',
	'eligibility',
	'can_encash',
	'is_npl',
	'consumes_code',
	'entitlement'
);
const ROSTER = pick(
	'id',
	'employment_id',
	'work_date',
	'shift_definition_id',
	'worked_intervals',
	'approved_overtime_hours',
	'banked_overtime_hours',
	'banked_overtime_band',
	'incentive_hours',
	'overtime_consented_at',
	'worksite',
	'facts',
	'payslip_id'
);
const HOLIDAY = pick('id', 'date', 'name', 'kind', 'published_at', 'replaces', 'given_to');
const HISTORY = pick(
	'id',
	'payroll_run_id',
	'employment_id',
	'status',
	'proration',
	'salary_from',
	'statutory',
	'base',
	'adjustments',
	'gross',
	'net'
);
const CATALOG = {
	adhoc_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'counts_toward',
		'eligibility',
		'qualifies_when',
		'bands',
		'payable_after_exit',
		'raise_on_exit',
		'amount_required'
	),
	claim_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'counts_toward',
		'eligibility',
		'qualifies_when',
		'bands',
		'amount_required'
	),
	leave_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'eligibility',
		'is_npl',
		'can_encash',
		'pay_fraction',
		'share_by'
	),
	loan_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'eligibility',
		'bands',
		'amount_required'
	),
	allowance_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'counts_toward',
		'eligibility',
		'amount'
	),
	work_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'component_code',
		'eligibility',
		'quantity',
		'rate',
		'prorated',
		'denominator',
		'destination',
		'direction',
		'counts_toward'
	)
} as const;

/** The four entry families: their collection, their catalogue and the run line family they produce. */
export const FAMILIES = [
	{ collection: 'adhoc_catalog_entry', catalog: 'adhoc_catalog', family: 'ADHOC' },
	{ collection: 'claim_catalog_entry', catalog: 'claim_catalog', family: 'CLAIM' },
	{ collection: 'leave_catalog_entry', catalog: 'leave_catalog', family: 'LEAVE' },
	{ collection: 'loan_catalog_entry', catalog: 'loan_catalog', family: 'LOAN_REPAYMENT' }
] as const;

/** A version with every catalogue row a payroll build prices from. */
const GOVERNED: Selection = {
	id: true,
	statutory_contribution_catalog: { many: STATUTORY },
	work_catalog: { many: CATALOG.work_catalog },
	allowance_catalog: { many: CATALOG.allowance_catalog },
	...Object.fromEntries(
		FAMILIES.map((family) => [family.catalog, { many: CATALOG[family.catalog] }])
	),
	rule_set: {
		many: pick('code', 'family', 'rules'),
		where: { family: { in: ['PAYROLL', 'VALIDATIONS'] } }
	},
	suspension_kind: { many: pick('code', 'counts_as_attended', 'scheduled', 'pay') }
};
type Governed = {
	readonly id: string;
	readonly statutory_contribution_catalog: readonly StatutoryRow[];
	readonly work_catalog: readonly CatalogRow[];
	readonly allowance_catalog: readonly CatalogRow[];
	readonly rule_set: readonly { code: string; family: string; rules?: Json }[];
	readonly suspension_kind: readonly SuspensionKind[];
	readonly [catalog: string]: unknown;
};
type EntryFamily = (typeof FAMILIES)[number];
type EntryCollection = EntryFamily['collection'];
type CatalogName<C extends EntryCollection> = Extract<EntryFamily, { collection: C }>['catalog'];

type LeaveAdmitted = {
	readonly company_id: string;
	readonly catalog_id: Id<'leave_catalog'>;
	readonly version: SettingsRow;
};

const isLeaveAdmitted = (
	collection: EntryCollection,
	admitted: {
		readonly company_id: string;
		readonly catalog_id: Id<CatalogName<EntryCollection>>;
		readonly version: SettingsRow;
	}
): admitted is LeaveAdmitted => collection === 'leave_catalog_entry';

const termFor = (contract: ContractRow, day: string): ContractTerm | undefined =>
	(contract.facts?.contract_terms ?? [])
		.filter((term) => term.effective_range != null && dayInRange(day, term.effective_range))
		.sort((left, right) =>
			String(left.effective_range?.from).localeCompare(String(right.effective_range?.from))
		)
		.at(-1);

const moneyValue = (value: unknown): number => moneyNumber(value) ?? 0;

/** How many settlement periods a pay frequency cuts a calendar month into. */
const PARTS: { readonly [frequency: string]: number } = {
	MONTHLY: 1,
	INTEGER_MONTHS: 1,
	SEMI_MONTHLY: 2,
	TEN_DAY: 3
};
/** A weekly month holds the Sunday–Saturday weeks starting in it; a daily month, its days. */
const partsIn = (frequency: string, month: string, weekStart = 0): number | undefined =>
	frequency === 'WEEKLY'
		? weeklyInstalments(month, weekStart).length
		: frequency === 'DAILY'
			? days(monthOf(`${month}-01`))
			: PARTS[frequency];
/** Frequencies whose periods are not a cut of the month's attendance: no cutoff day moves them. */
const CYCLES: readonly string[] = ['WEEKLY', 'DAILY'];

/** One settlement period inside its calendar month, and where it sits: part `part` of the month's `parts`. */
export type SettlementPeriod = {
	readonly from: string;
	readonly to: string;
	readonly part: number;
	readonly parts: number;
};

/**
 * A run's period key in its entity's grammar: `YYYY-MM` for a monthly entity, `YYYY-MM-<part>` (1-based) for a
 * sub-monthly one (`SEMI_MONTHLY` 1–15 / 16–end, `TEN_DAY` 1–10 / 11–20 / 21–end, `WEEKLY` the n-th Sunday–Saturday
 * week starting in the month), `YYYY-MM-DD` for a `DAILY` one (part = the day of the month).
 */
export const settlementPeriod = (
	period: string,
	frequency: string,
	/** The governing version's calendar: `payroll.week_start`, `payroll.semi_monthly_split`. */
	calendar: { readonly week_start?: number; readonly semi_monthly_split?: number } = {}
): Effect.Effect<SettlementPeriod, Refusal> => {
	const month = /^\d{4}-(0[1-9]|1[0-2])/.test(period) ? period.slice(0, 7) : null;
	const parts = month == null ? undefined : partsIn(frequency, month, calendar.week_start);
	if (parts == null && month != null)
		return Effect.fail(
			new Refusal({
				message: `Payroll frequency ${frequency} requires its own settlement calendar.`
			})
		);
	const shape =
		frequency === 'DAILY'
			? /^\d{4}-\d{2}-\d{2}$/
			: parts === 1
				? /^\d{4}-\d{2}$/
				: new RegExp(`^\\d{4}-\\d{2}-[1-${parts}]$`);
	if (parts == null || !shape.test(period))
		return Effect.fail(
			new Refusal({
				message:
					frequency === 'DAILY'
						? 'A DAILY payroll run needs its pay day as YYYY-MM-DD.'
						: parts === 1 || parts == null
							? 'A payroll run needs its pay period as YYYY-MM.'
							: `A ${frequency} payroll run needs its pay period as YYYY-MM-<1–${parts}>.`
			})
		);
	return Effect.try({
		try: () => {
			const { start, end } = payPeriodWindow(period, {
				pay_frequency: frequency,
				...(calendar.week_start == null ? {} : { week_start: calendar.week_start }),
				...(calendar.semi_monthly_split == null
					? {}
					: { semi_monthly_split: calendar.semi_monthly_split })
			});
			return { from: start, to: end, part: parts === 1 ? 1 : Number(period.slice(8)), parts };
		},
		catch: (cause) =>
			cause instanceof Refusal
				? cause
				: new Refusal({ message: 'A pay period requires its actual calendar month.' })
	});
};

/** The frequencies a switch may name: those that cut the calendar month. */
// ponytail: WEEKLY and DAILY periods straddle months; a switch to or from them needs a settlement across months
const SWITCHABLE: readonly string[] = ['MONTHLY', 'INTEGER_MONTHS', 'SEMI_MONTHLY', 'TEN_DAY'];

/**
 * Why an entity write would rewrite its pay schedule's history, if it would: `pay_frequency` is the frequency from the
 * start and stays once a salary run is paid at it; each `pay_frequency_changes` row switches it from its day, one a
 * day, to another of the month-cutting frequencies; no switch on or before `lastPaid` (the last day a salary run
 * covers) is added, moved or withdrawn, so a paid period keeps its frequency and no two periods cover one day.
 */
export const payScheduleRefusal = (
	before: Pick<EntityRow, 'pay_frequency' | 'pay_frequency_changes'>,
	after: Pick<EntityRow, 'pay_frequency' | 'pay_frequency_changes'>,
	lastPaid: string | null
): string | undefined => {
	const changes = (after.pay_frequency_changes ?? []).toSorted((a, b) =>
		a.from.localeCompare(b.from)
	);
	if (new Set(changes.map((change) => change.from)).size !== changes.length)
		return 'A pay schedule takes one switch a day.';
	for (const change of changes) {
		const was = frequencyOn(after, String(addDays(change.from, -1)));
		for (const frequency of [was, change.frequency])
			if (!SWITCHABLE.includes(frequency))
				return `A switch to or from ${frequency} is not offered: its periods straddle calendar months, and a switched month settles by the calendar month. Switch between ${SWITCHABLE.join(', ')}.`;
		if (was === change.frequency)
			return `On ${change.from} the entity already pays ${change.frequency}.`;
	}
	if (lastPaid == null) return undefined;
	if ((before.pay_frequency ?? 'MONTHLY') !== (after.pay_frequency ?? 'MONTHLY'))
		return `A salary run already paid at ${before.pay_frequency ?? 'MONTHLY'}: record a switch from a day after ${lastPaid} instead.`;
	const paid = (list: readonly FrequencyChange[] | null | undefined) =>
		stableJson(
			(list ?? [])
				.filter((change) => change.from <= lastPaid)
				.toSorted((a, b) => a.from.localeCompare(b.from))
		);
	if (paid(before.pay_frequency_changes) !== paid(changes))
		return `Salary runs are paid through ${lastPaid}: a switch starts after that day.`;
	return undefined;
};

/**
 * A settlement period's salary and attendance windows. A cutoff day (2–28) moves the month's attendance to the
 * previous month's cutoff through the day before this month's; a part of the month moves by the same offset, the
 * month's last part ending where the month's attendance ends.
 */
const payrollWindow = (
	settlement: SettlementPeriod,
	cutoff: number
): { salary_from: string; salary_to: string; attendance_from: string; attendance_to: string } => {
	const month = monthOf(settlement.from);
	const salary_from = settlement.from;
	const salary_to = settlement.to;
	if (!(cutoff >= 2 && cutoff <= 28))
		return { salary_from, salary_to, attendance_from: salary_from, attendance_to: salary_to };
	const stamp = new Date(`${String(month.from)}T00:00:00Z`);
	stamp.setUTCMonth(stamp.getUTCMonth() - 1, cutoff);
	const offset = (stamp.getTime() - Date.parse(`${String(month.from)}T00:00:00Z`)) / 86_400_000;
	return {
		salary_from,
		salary_to,
		attendance_from: String(addDays(salary_from, offset)),
		attendance_to:
			salary_to === String(month.to)
				? `${salary_from.slice(0, 7)}-${String(cutoff - 1).padStart(2, '0')}`
				: String(addDays(salary_to, offset))
	};
};

/** One stored expression against its context; a failing or ill-typed expression refuses with its record named. */
const evaluate = (
	expression: string,
	context: DynObject,
	where: string
): Effect.Effect<unknown, Refusal> =>
	Effect.try({
		try: () => evaluateConfigured(expression, context),
		catch: (cause) =>
			cause instanceof Refusal
				? new Refusal({
						message: `${where}: ${cause.message}`,
						...(cause.detail === undefined ? {} : { detail: cause.detail })
					})
				: new Refusal({ message: `${where}: the stored expression failed.`, detail: String(cause) })
	});

const evaluateNumber = (expression: string, context: DynObject, where: string) =>
	evaluate(expression, context, where).pipe(
		Effect.flatMap((value) =>
			Schema.is(Schema.Number)(value) && Number.isFinite(value)
				? Effect.succeed(value)
				: Effect.fail(
						new Refusal({ message: `${where}: the stored expression must return a number.` })
					)
		)
	);

const evaluateBoolean = (expression: string | undefined, context: DynObject, where: string) =>
	expression == null || expression.trim() === ''
		? Effect.succeed(true)
		: evaluate(expression, context, where).pipe(
				Effect.flatMap((value) =>
					Schema.is(Schema.Boolean)(value)
						? Effect.succeed(value)
						: Effect.fail(
								new Refusal({
									message: `${where}: the stored predicate must return true or false.`
								})
							)
				)
			);

/** The sealed version of an entity's lineage in force on one day. */
/** The version of a lineage governing a day: approved, sealed, not voided, the latest whose range holds the day. */
/** The zone an entity counts `day` in: its own, else the `payroll.timezone` of its lineage's version governing the day
 * among `versions` (any lineage's rows; the entity's are picked by its code), else the workspace's. */
export const zoneOn = (
	entity: Pick<EntityRow, 'time_zone' | 'settings_code'>,
	versions: readonly SettingsRow[],
	day: string
): string =>
	zoneOf(
		entity,
		Option.getOrUndefined(
			Effect.runSync(
				Effect.option(
					versionOn(
						versions.filter((row) => row.code === entity.settings_code),
						entity.settings_code,
						day
					)
				)
			)
		)
	);

export const versionOn = (
	versions: readonly SettingsRow[],
	settings_code: string | null | undefined,
	day: string
): Effect.Effect<SettingsRow, Refusal> => {
	const version = versions
		.filter(
			(row) =>
				row.approval_id == null &&
				row.voided_at == null &&
				row.sealed_at != null &&
				row.effective_range != null &&
				dayInRange(day, row.effective_range)
		)
		.sort((left, right) =>
			String(left.effective_range?.from).localeCompare(String(right.effective_range?.from))
		)
		.at(-1);
	return version == null
		? Effect.fail(
				new Refusal({ message: `No sealed ${settings_code} jurisdiction version governs ${day}.` })
			)
		: Effect.succeed(version);
};

/** A lineage's approved, sealed, unvoided versions: one read serves every day `versionOn` picks from them. */
export const sealedVersions = (settings_code: string | null | undefined) =>
	readAll<SettingsRow>(
		'jurisdiction_settings',
		{
			code: { eq: settings_code },
			approval_id: { isNull: true },
			voided_at: { isNull: true },
			sealed_at: { isNull: false }
		},
		undefined,
		SETTINGS
	);

export const governingVersion = (
	entity: Pick<EntityRow, 'settings_code'>,
	day: string
): Effect.Effect<SettingsRow, Refusal> =>
	readJoined<SettingsRow>(
		'jurisdiction_settings',
		{
			code: { eq: entity.settings_code },
			approval_id: { isNull: true },
			voided_at: { isNull: true },
			sealed_at: { isNull: false }
		},
		{ ...SETTINGS, ...PAYROLL_RULES }
	).pipe(Effect.flatMap((versions) => versionOn(versions, entity.settings_code, day)));

const entityOf = (company_id: string): Effect.Effect<EntityRow, Refusal> =>
	Effect.gen(function* () {
		const [entity] = yield* readAll<EntityRow>(
			'entity',
			{ id: { eq: company_id }, approval_id: { isNull: true } },
			undefined,
			ENTITY
		);
		if (entity == null)
			return yield* Effect.fail(
				new Refusal({ message: 'This needs an actual approved legal entity.' })
			);
		return entity;
	});

/** One employment with its person, its entity and the entity's contracts (its headcount), and `arms` of its own. */
const EMPLOYMENT = {
	...CONTRACT,
	person: { one: 'employee_id', select: PROFILE },
	company: {
		one: 'company_id',
		select: {
			...ENTITY,
			approval_id: true,
			employment_contract: {
				many: pick('id', 'effective_range', 'engagement'),
				where: { approval_id: { isNull: true } }
			}
		}
	}
} as const;
type Employment = ContractRow & {
	readonly person: EmployeeRow | null;
	readonly company:
		| (EntityRow & {
				readonly approval_id?: string | null;
				readonly employment_contract: readonly Pick<
					ContractRow,
					'id' | 'effective_range' | 'engagement'
				>[];
		  })
		| null;
} & { readonly [arm: string]: unknown };

const employmentOf = (employment_id: string, arms: Selection = {}) =>
	readJoined<Employment>(
		'employment_contract',
		{ id: { eq: employment_id } },
		{ ...EMPLOYMENT, ...arms }
	).pipe(Effect.map(([held]) => held));

/** What a leave subject reads beside the employment: its payslips, each with its run's kind. */
const SUBJECT_ARMS = {
	payslip: { many: { ...HISTORY, run: { one: 'payroll_run_id', select: pick('kind') } } }
} as const;
/** A leave write's subject: `SUBJECT_ARMS` and every movement of the employment, each with its class's code. */
const LEAVE_SUBJECT_ARMS = {
	...SUBJECT_ARMS,
	leave_catalog_entry: {
		many: {
			...pick(
				'catalog_id',
				'employment_id',
				'activity',
				'occurred_on',
				'approval_id',
				'days',
				'from',
				'to',
				'facts'
			),
			catalog: { one: 'catalog_id', select: pick('code') }
		}
	}
} as const;

/** The employment's approved entity, or the refusal `entityOf` gives. */
const companyOf = (held: Employment): Effect.Effect<NonNullable<Employment['company']>, Refusal> =>
	held.company == null || held.company.approval_id != null
		? Effect.fail(new Refusal({ message: 'This needs an actual approved legal entity.' }))
		: Effect.succeed(held.company);

/**
 * Admit one payroll run request: its entity, the version governing its period, the behaviour that admits its kind,
 * no second salary run for the period, and — for a settlement run — only approved, unpaid ad hoc or claim entries.
 * The run collection's transform and the run build both admit through here.
 */
export const admitPayrollRun = (request: PayrollRunRequest) =>
	Effect.gen(function* () {
		const salaryRun = SALARY_RUNS.includes(request.kind);
		const sources = request.sources ?? [];
		const offCycle = FAMILIES.filter((family) => family.family !== 'LEAVE');
		// One keyed read: the entity, its runs and — for a settlement run — which selected entries are open, and
		// every version of its lineage (the `settings_code` it names) with its scheme rows' codes; the governing
		// versions are picked in memory.
		const got = yield* readJoinedSet({
			entity: {
				collection: 'entity',
				where: { id: { eq: request.company_id }, approval_id: { isNull: true } },
				selection: {
					...ENTITY,
					payroll_run: { many: pick('id', 'kind', 'period', 'salary_from', 'salary_to') },
					...(salaryRun || sources.length === 0
						? {}
						: Object.fromEntries(
								offCycle.map((family) => [
									family.collection,
									{
										many: pick('id'),
										where: {
											id: { in: sources },
											approval_id: { isNull: true },
											payslip_id: { isNull: true }
										}
									}
								])
							))
				}
			},
			lineage: {
				collection: 'jurisdiction_settings',
				where: { code: { in: { member: 'entity', field: 'settings_code' } } },
				selection: {
					...SETTINGS,
					statutory_contribution_catalog: { many: pick('id', 'code') },
					// every allowance class of the lineage by id: a contract allowance names the row it was captured under
					allowance_catalog: { many: pick('id', 'code') }
				}
			},
			// the versions over the run's month with every catalogue row the build prices from (the governing one is
			// picked in memory): the build reads nothing more of the version
			month_versions: {
				collection: 'jurisdiction_settings',
				where: {
					code: { in: { member: 'entity', field: 'settings_code' } },
					approval_id: { isNull: true },
					voided_at: { isNull: true },
					sealed_at: { isNull: false },
					effective_range: {
						overlaps: {
							from: `${request.period.slice(0, 7)}-01`,
							to: String(monthOf(`${request.period.slice(0, 7)}-01`).to)
						}
					}
				},
				selection: GOVERNED
			}
		});
		const [held] = got<
			EntityRow & {
				readonly payroll_run: readonly {
					id: string;
					kind?: string;
					period?: string;
					salary_from?: string | null;
					salary_to?: string | null;
				}[];
			} & { readonly [collection: string]: unknown }
		>('entity');
		if (held == null)
			return yield* Effect.fail(
				new Refusal({ message: 'This needs an actual approved legal entity.' })
			);
		const runs = held.payroll_run;
		const entity: EntityRow = held;
		const lineage = got<
			SettingsRow & { readonly statutory_contribution_catalog: readonly StatutoryRow[] }
		>('lineage');
		// The frequency in force on the period's days (`pay_frequency_changes`): a key the month's frequencies do not
		// offer is refused, and a period a switch cuts covers only its own frequency's days.
		const month = request.period.slice(0, 7);
		const spans = frequencySpans(entity, month);
		const offered = [
			...new Set(
				periodsIn(entity, month)
					.filter((held) => held.key === request.period)
					.map((held) => held.frequency)
			)
		];
		if (offered.length !== 1)
			return yield* Effect.fail(
				new Refusal({
					message:
						offered.length === 0
							? `${request.period} is no pay period of ${entity.name ?? 'the entity'}: it pays ${spans.map((span) => `${span.frequency} ${span.from}–${span.to}`).join(', ')}.`
							: `${request.period} names a period of more than one pay frequency in force that month.`
				})
			);
		const frequency = offered[0] as PayrollFrequency;
		// The period cut by the calendar of the version in force at its default start, then governed from its own.
		const first = yield* versionOn(
			lineage,
			entity.settings_code,
			(yield* settlementPeriod(request.period, frequency)).from
		);
		const nominal = yield* settlementPeriod(request.period, frequency, first.payroll ?? {});
		// ponytail: one span of the frequency per month; a switch away and back inside one month is refused above
		const own = spans.find((span) => span.frequency === frequency)!;
		const settlement = {
			...nominal,
			from: nominal.from > own.from ? nominal.from : own.from,
			to: nominal.to < own.to || frequency === 'WEEKLY' ? nominal.to : own.to
		};
		// a month paid at more than one frequency settles each line month to date (`buildPayrollRun`)
		const switched = spans.length > 1;
		const version = dayInRange(settlement.from, first.effective_range ?? {})
			? first
			: yield* versionOn(lineage, entity.settings_code, settlement.from);
		// The governing behaviours admit the run: which kinds a jurisdiction pays is a record, not a branch here.
		const admitted =
			version.behaviours != null &&
			planBehaviours(
				version.behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: request.kind, period: request.period } } } }
			).length > 0;
		if (!admitted)
			return yield* Effect.fail(
				new Refusal({
					message: `${version.code} admits no ${request.kind} payroll run under its behaviours.`
				})
			);
		// A later period's runs read this one's year to date: an earlier period is run before them, never after.
		const later = runs
			.filter(
				(run) =>
					run.id !== request.run_id &&
					run.salary_from != null &&
					String(run.salary_from).slice(0, 10) > settlement.to
			)
			.map((run) => String(run.period))
			.toSorted();
		if (later.length > 0)
			return yield* Effect.fail(
				new Refusal({
					message: `${later.join(', ')} already has a run: delete the runs after ${request.period}, latest first, and rebuild them after it, so their year to date reads it.`
				})
			);
		// Salary runs never cover one day twice: a period over days another frequency's run already paid is refused.
		const overlapping = runs.find(
			(run) =>
				run.id !== request.run_id &&
				run.period !== request.period &&
				isSalaryRun(run.kind) &&
				run.salary_from != null &&
				run.salary_to != null &&
				String(run.salary_from).slice(0, 10) <= settlement.to &&
				String(run.salary_to).slice(0, 10) >= settlement.from
		);
		if (salaryRun && overlapping != null)
			return yield* Effect.fail(
				new Refusal({
					message: `${request.period} covers days ${String(overlapping.period)} already paid.`
				})
			);
		if (
			salaryRun &&
			runs.some(
				(run) => run.id !== request.run_id && run.period === request.period && isSalaryRun(run.kind)
			)
		)
			return yield* Effect.fail(
				new Refusal({
					message: `${request.period} already has a salary run. Delete it to re-run, or create an off-cycle run for one-off payments.`
				})
			);
		if (!salaryRun) {
			if (sources.length === 0)
				return yield* Effect.fail(
					new Refusal({
						message:
							'An off-cycle or correction run pays only the ad hoc or claim entries it selects; select at least one.'
					})
				);
			const families = version.payroll?.off_cycle_families ?? ['ADHOC', 'CLAIM'];
			const open = new Set(
				offCycle
					.filter((family) => families.includes(family.family))
					.flatMap((family) => {
						const rows = held[family.collection];
						return Array.isArray(rows)
							? rows.map((row) => String(isJsonObject(row) ? row['id'] : ''))
							: [];
					})
			);
			const missing = sources.filter((id) => !open.has(id));
			if (missing.length > 0)
				return yield* Effect.fail(
					new Refusal({
						message: `${missing.length} selected entr${missing.length === 1 ? 'y is' : 'ies are'} not an approved, unpaid entry of a family ${version.code} lets an off-cycle run pay.`
					})
				);
		}
		const governedRows = got<Governed>('month_versions');
		return {
			entity: { ...entity, pay_frequency: frequency },
			version,
			settlement,
			salaryRun,
			sources,
			runs,
			lineage,
			governedRows,
			switched
		};
	});

/**
 * The subject of a rule — the person, the company, the contract terms in force and the employment — as the CEL roots
 * `employee`, `company`, `terms`, `employment` and `person`. Every site shares it; what a rule reads from it is the
 * record's business.
 */
export const subjectContext = (input: {
	readonly contract: Pick<ContractRow, 'effective_range' | 'exit_ground' | 'exit_facts'> & {
		readonly engagement?: string | null;
		readonly prior_service_months?: number | null;
	};
	readonly employee: EmployeeRow | undefined;
	readonly entity: EntityRow | undefined;
	readonly term: ContractTerm | undefined;
	readonly day: string;
	/** The entity's contracts in force on the day. */
	readonly headcount: number;
	/** The governing version: its `payroll.monthly_wage` CEL defines `terms.monthly_wage`. */
	readonly version?: SettingsRow | undefined;
}): DynObject => {
	const { contract, employee, entity, term, day } = input;
	const from = contract.effective_range?.from;
	const employment = {
		classification: term?.work_classification ?? '',
		service_months:
			num(contract.prior_service_months) +
			(from == null || from === '' ? 0 : Math.max(0, completedMonths(from, day))),
		start_date: from ?? '',
		engagement: contract.engagement ?? 'EMPLOYEE',
		exit_date: contract.effective_range?.to ?? '',
		exit_ground: contract.exit_ground ?? '',
		exit_facts: isDynObject(contract.exit_facts) ? contract.exit_facts : {}
	};
	const birth = employee?.date_of_birth;
	const base_salary = moneyValue(term?.base_salary);
	const subject = {
		employee: {
			gender: employee?.gender ?? '',
			marital_status: employee?.marital_status ?? '',
			spouse_status: employee?.spouse_status ?? '',
			solo_parent: employee?.solo_parent === true,
			disabled: employee?.disabled === true,
			receiving_pension: employee?.receiving_pension === true,
			nationality: employee?.nationality ?? '',
			date_of_birth: birth ?? '',
			age: birth == null || birth === '' ? null : Math.floor(completedMonths(birth, day) / 12),
			children: Array.isArray(employee?.children) ? employee.children : [],
			dependents_count: num(employee?.dependents_count),
			facts: isDynObject(employee?.facts) ? employee.facts : {}
		},
		company: {
			region: entity?.region ?? '',
			risk_class: entity?.risk_class ?? '',
			pay_frequency: entity?.pay_frequency ?? '',
			headcount: input.headcount,
			facts: isDynObject(entity?.facts) ? entity.facts : {}
		},
		terms: {
			// Every key the term carries (a grade, a pay frequency, a department), beside the engine's own below.
			...(isDynObject(term) ? term : {}),
			work_classification: term?.work_classification ?? '',
			statutory_work_category: term?.statutory_work_category ?? '',
			employment_type: term?.employment_type ?? '',
			facts: isDynObject(term?.facts) ? term.facts : {},
			residency_status: term?.residency_status ?? '',
			residency_since: term?.residency_since ?? '',
			base_salary,
			effective_from: term?.effective_range?.from ?? '',
			effective_to: term?.effective_range?.to ?? '',
			allowances: (term?.allowances ?? []).map((line) => ({
				code: line.code ?? '',
				catalogue_id: line.catalogue_id ?? '',
				amount: moneyValue(line.amount)
			})),
			monthly_wage: 0
		},
		employment,
		person: {
			employment,
			race: employee?.race ?? null,
			religion: employee?.religion ?? null,
			nationality: employee?.nationality ?? null,
			residency_status: term?.residency_status ?? null,
			residency_since: term?.residency_since ?? null
		}
	};
	// The monthly wage: the version's `payroll.monthly_wage` CEL on `terms`, else base salary plus every fixed allowance.
	const rule = input.version?.payroll?.monthly_wage;
	const wage =
		rule == null || rule.trim() === ''
			? base_salary +
				(term?.allowances ?? []).reduce((total, line) => total + moneyValue(line.amount), 0)
			: (numberOf(evaluateConfigured(rule, { terms: subject.terms })) ?? 0);
	const out = { ...subject, terms: { ...subject.terms, monthly_wage: wage } };
	return isDynObject(out) ? out : {};
};

/** How many of the entity's contracts are in force on a day: the CEL `company.headcount` (and `headcount`). */
const inForce = (
	contracts: readonly Pick<ContractRow, 'effective_range' | 'engagement'>[],
	day: string
): number =>
	contracts.filter(
		(contract) => contract.engagement !== 'PAYEE' && dayInRange(day, contract.effective_range ?? {})
	).length;

const headcountOn = (company_id: string, day: string) =>
	readAll<Pick<ContractRow, 'id' | 'effective_range' | 'engagement'>>(
		'employment_contract',
		{ company_id: { eq: company_id }, approval_id: { isNull: true } },
		undefined,
		pick('id', 'effective_range', 'engagement')
	).pipe(Effect.map((contracts) => inForce(contracts, day)));

// ponytail: separations reach a year either side of the day (mass-layoff and notice windows); longer needs more.
const SEPARATION_DAYS = 366;

/**
 * The entity's staffing on a day (payees left out): its contracts in force (`headcount`), the same by worksite
 * (`headcount_by_worksite`, the terms in force's `facts.worksite`, blank when none), at each of the 12 month ends
 * through the day's month (`headcount_months[]`, `{ month, headcount }`), and its `separations` — every contract ending
 * within a year either side of the day, each `{ employment_id, exit_date, exit_ground, exit_facts, term_facts,
 * worksite, fixed_term }` (of the terms in force on the exit day). A count by cause, worksite or window is the
 * record's own filter.
 */
export const staffingOn = (company_id: string, day: string) =>
	readAll<ContractRow>(
		'employment_contract',
		{ company_id: { eq: company_id }, approval_id: { isNull: true } },
		undefined,
		STAFFING
	).pipe(Effect.map((all) => staffingFrom(all, day)));

/** What `staffingOn` reads of an entity's approved contracts. */
export const STAFFING = pick(
	'id',
	'company_id',
	'effective_range',
	'engagement',
	'exit_ground',
	'exit_facts',
	'facts'
);

/** `staffingOn` over contracts already read (the entity's approved ones). */
export const staffingFrom = (all: readonly ContractRow[], day: string) => {
	const contracts = all.filter((contract) => contract.engagement !== 'PAYEE');
	const from = String(addDays(day, -SEPARATION_DAYS));
	const to = String(addDays(day, SEPARATION_DAYS));
	const headcount_by_worksite: { [worksite: string]: number } = {};
	const headcount_permanent_by_worksite: { [worksite: string]: number } = {};
	for (const contract of contracts)
		if (dayInRange(day, contract.effective_range ?? {})) {
			const site = worksiteOn(undefined, termFor(contract, day));
			headcount_by_worksite[site] = (headcount_by_worksite[site] ?? 0) + 1;
			if (termFor(contract, day)?.facts?.['fixed_term'] !== true)
				headcount_permanent_by_worksite[site] = (headcount_permanent_by_worksite[site] ?? 0) + 1;
		}
	const fixedTerm = (contract: ContractRow) =>
		termFor(contract, day)?.facts?.['fixed_term'] === true;
	return {
		headcount: inForce(contracts, day),
		// Contracts in force not on a fixed term (`terms.facts.fixed_term`).
		headcount_permanent: inForce(
			contracts.filter((contract) => !fixedTerm(contract)),
			day
		),
		headcount_by_worksite,
		// The same without fixed-term contracts (a site with none is absent: `has()`).
		headcount_permanent_by_worksite,
		headcount_months: Array.from({ length: HISTORY_MONTHS }, (_, i) => {
			const month = monthOf(addMonths(String(monthOf(day).from), i + 1 - HISTORY_MONTHS));
			return {
				month: String(month.from).slice(0, 7),
				headcount: inForce(contracts, String(month.to))
			};
		}),
		separations: contracts
			.flatMap((contract) => {
				const exit = contract.effective_range?.to;
				if (exit == null || exit < from || exit > to) return [];
				const term = termFor(contract, exit);
				const facts = term?.facts;
				return [
					{
						employment_id: contract.id,
						exit_date: exit,
						exit_ground: contract.exit_ground ?? '',
						exit_facts: isJsonObject(contract.exit_facts) ? contract.exit_facts : {},
						term_facts: isJsonObject(facts) ? facts : {},
						worksite: worksiteOn(undefined, term),
						fixed_term: facts?.['fixed_term'] === true
					}
				];
			})
			// By exit day: a window count is `count_within(separations, "exit_date", from, to)`.
			.toSorted((left, right) => left.exit_date.localeCompare(right.exit_date))
	};
};

/** Catalogue row ids to their class codes, whatever version holds them. */
const catalogCodes = (catalog: 'leave_catalog', ids: readonly string[]) =>
	(ids.length === 0
		? Effect.succeed([])
		: readAll<{ id: string; code: string }>(
				catalog,
				{ id: { in: [...new Set(ids)] } },
				undefined,
				pick('id', 'code')
			)
	).pipe(Effect.map((rows) => new Map(rows.map((row) => [row.id, row.code]))));

/** The version's PAYROLL rule-set rows as the CEL root `rules`, keyed by code (`rules.minimum_wage.by_region`). */
const versionRules = (version: SettingsRow) =>
	readAll<{ code: string; rules?: Json }>(
		'rule_set',
		{ settings_id: { eq: version.id }, family: { eq: 'PAYROLL' } },
		undefined,
		RULES
	).pipe(Effect.map((rows) => Object.fromEntries(rows.map((row) => [row.code, row.rules ?? {}]))));

/**
 * A version's `VALIDATIONS` rule-set rows: each `rules` names its `site` (`contract`: a contract's terms as written;
 * `payslip`: each slip of a build), its `kind` (`refuse` the write, `warn` in the run's warnings, `hold` the slip
 * ON_HOLD), the CEL `when` that trips it and the `message`.
 */
const Validation = Schema.Struct({
	site: Schema.Literals(['contract', 'payslip', 'roster']),
	kind: Schema.Literals(['refuse', 'warn', 'hold']),
	when: Schema.String,
	message: Schema.String,
	description: Schema.optional(Schema.String),
	/** `roster`: the sheet field the finding points at (`overtime_hours`, `clock_in`, …). */
	column: Schema.optional(Schema.String)
});
type Validation = typeof Validation.Type & { readonly code: string };

const versionValidations = (version: SettingsRow, site: Validation['site']) =>
	readAll<{ code: string; rules?: unknown }>(
		'rule_set',
		{ settings_id: { eq: version.id }, family: { eq: 'VALIDATIONS' } },
		undefined,
		RULES
	).pipe(Effect.flatMap((rows) => validationsOf(rows, site)));

/** A version's `VALIDATIONS` rows of one site, each checked for its shape. */
const validationsOf = (
	rows: readonly { code: string; rules?: unknown }[],
	site: Validation['site']
) =>
	Effect.gen(function* () {
		const out: Validation[] = [];
		for (const row of rows) {
			if (!Schema.is(Validation)(row.rules))
				return yield* Effect.fail(
					new Refusal({
						message: `rule_set ${row.code}: a validation names its site, kind, when and message.`
					})
				);
			if (row.rules.site === site) out.push({ ...row.rules, code: row.code });
		}
		return out;
	});

/** The validations that trip on one context, in code order. */
const tripped = (validations: readonly Validation[], context: DynObject) =>
	Effect.gen(function* () {
		const out: Validation[] = [];
		for (const check of validations.toSorted((left, right) => left.code.localeCompare(right.code)))
			if (yield* evaluateBoolean(check.when, context, `rule_set ${check.code}`)) out.push(check);
		return out;
	});

const Range = Schema.Struct({
	from: Schema.optionalKey(Schema.NullOr(Schema.String)),
	to: Schema.optionalKey(Schema.NullOr(Schema.String))
});
/** A contract's terms as a write carries them: what the subject context reads. */
const TermInput = Schema.Struct({
	effective_range: Schema.optionalKey(Range),
	base_salary: Schema.optionalKey(
		Schema.Struct({
			value: Schema.optionalKey(Schema.Number),
			currency: Schema.optionalKey(Schema.String)
		})
	),
	allowances: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				catalogue_id: Schema.optionalKey(Schema.String),
				code: Schema.optionalKey(Schema.String),
				amount: Schema.optionalKey(
					Schema.Union([Schema.Number, Schema.Struct({ value: Schema.optionalKey(Schema.Number) })])
				)
			})
		)
	),
	residency_status: Schema.optionalKey(Schema.String),
	residency_since: Schema.optionalKey(Schema.String),
	work_classification: Schema.optionalKey(Schema.String),
	statutory_work_category: Schema.optionalKey(Schema.String),
	employment_type: Schema.optionalKey(Schema.String),
	shift_pattern_id: Schema.optionalKey(Schema.String),
	facts: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
});
const ContractFacts = Schema.NullOr(
	Schema.Struct({ contract_terms: Schema.optionalKey(Schema.Array(TermInput)) })
);
const ContractInput = Schema.Struct({
	company_id: Schema.String,
	employee_id: Schema.String,
	effective_range: Schema.optionalKey(Range),
	prior_service_months: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	exit_ground: Schema.optionalKey(Schema.NullOr(Schema.String)),
	exit_facts: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
	facts: Schema.optionalKey(ContractFacts)
});

/**
 * A contract's terms as written, against the `contract` validations of the version governing each new or changed
 * term's first day: the first that trips refuses the write. A day no sealed version governs has nothing to check.
 */
export const admitContractTerms = (input: {
	readonly contract: unknown;
	readonly before: unknown;
}) =>
	Effect.gen(function* () {
		const decoded = Schema.decodeUnknownOption(ContractInput)(input.contract);
		if (decoded._tag === 'None')
			return yield* Effect.fail(
				new Refusal({ message: 'This contract needs its entity, person and terms.' })
			);
		const contract = decoded.value;
		const previous = Schema.decodeUnknownOption(ContractFacts)(input.before);
		const held = new Set(
			(previous._tag === 'None' ? [] : (previous.value?.contract_terms ?? [])).map((term) =>
				stableJson(term)
			)
		);
		const changed = (contract.facts?.contract_terms ?? []).filter(
			(term) => !held.has(stableJson(term)) && term.effective_range?.from != null
		);
		if (changed.length === 0) return;
		const entity = yield* entityOf(contract.company_id);
		const [employee] = yield* readAll<EmployeeRow>(
			'employment_profile',
			{ id: { eq: contract.employee_id } },
			undefined,
			PROFILE
		);
		// The person's contracts with this employer, read once and only for a rule that names them.
		const selfId = isDynObject(input.contract) ? input.contract['id'] : undefined;
		let others: readonly ContractRow[] | undefined;
		const history = (checks: readonly Validation[]) =>
			Effect.gen(function* () {
				if (!/employment\.terms|person\.contracts/.test(JSON.stringify(checks))) return undefined;
				others ??= (yield* readAll<ContractRow>(
					'employment_contract',
					{
						employee_id: { eq: contract.employee_id },
						company_id: { eq: contract.company_id },
						approval_id: { isNull: true }
					},
					undefined,
					CONTRACT
				)).filter((row) => row.id !== selfId);
				return others;
			});
		for (const term of changed) {
			const day = String(term.effective_range!.from);
			const governing = yield* Effect.result(governingVersion(entity, day));
			if (Result.isFailure(governing)) continue;
			const version = governing.success;
			const checks = yield* versionValidations(version, 'contract');
			if (checks.length === 0) continue;
			const earlier = yield* history(checks);
			const subject = subjectContext({
				contract,
				employee,
				entity,
				term,
				day,
				headcount: yield* headcountOn(contract.company_id, day),
				version
			});
			// `employment.terms[]`: this employment's other terms; `person.contracts[]`: the person's other contracts
			// with this employer (`id`, `start`, `end`, `exit_ground`, `contract_type` and `facts` of their last term).
			const plainTerm = (held: unknown): JsonObject => {
				const copy = plain(held ?? {});
				return isJsonObject(copy) ? copy : {};
			};
			const extras: DynObject =
				earlier === undefined
					? {}
					: {
							employment: {
								...(isDynObject(subject.employment) ? subject.employment : {}),
								terms: (contract.facts?.contract_terms ?? [])
									.filter((other) => stableJson(other) !== stableJson(term))
									.map(plainTerm)
							},
							person: {
								...(isDynObject(subject.person) ? subject.person : {}),
								contracts: earlier
									.map((row) => {
										const last = (row.facts?.contract_terms ?? [])
											.toSorted((a, b) =>
												String(a.effective_range?.from).localeCompare(
													String(b.effective_range?.from)
												)
											)
											.at(-1);
										return {
											id: row.id,
											start: row.effective_range?.from ?? '',
											end: row.effective_range?.to ?? '',
											exit_ground: row.exit_ground ?? '',
											contract_type: last?.employment_type ?? '',
											facts: plainTerm(last?.facts),
											// Every term, oldest first: a first-term probation is seen too.
											terms: (row.facts?.contract_terms ?? [])
												.map((held) => ({
													from: held.effective_range?.from ?? '',
													to: held.effective_range?.to ?? '',
													contract_type: held.employment_type ?? '',
													facts: plainTerm(held.facts)
												}))
												.toSorted((a, b) => String(a.from).localeCompare(String(b.from)))
										};
									})
									.toSorted((a, b) => a.start.localeCompare(b.start))
							}
						};
			const context: DynObject = {
				...subject,
				...extras,
				rules: yield* versionRules(version),
				term: subject.terms ?? {},
				day
			};
			const [first] = (yield* tripped(checks, context)).filter((check) => check.kind === 'refuse');
			if (first != null) return yield* Effect.fail(new Refusal({ message: first.message }));
		}
	});

/** One person-day of a roster import as it would be stored; `ref` is the caller's handle on it (a sheet row). */
export type RosterDraft = {
	readonly ref: number;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id?: string | null;
	readonly worked_intervals?: unknown;
	readonly approved_overtime_hours?: number | null;
	readonly banked_overtime_hours?: number | null;
	readonly incentive_hours?: number | null;
	readonly overtime_consented_at?: string | null;
	/** The leave class covering the day, recorded or imported; blank when none. */
	readonly leave_code: string;
};
export type RosterFinding = {
	readonly ref: number;
	readonly code: string;
	readonly kind: Validation['kind'];
	readonly message: string;
	readonly column: string;
};

/** The days a set of roster drafts spans: what `rosterMembers` reads around. */
export const draftSpan = (drafts: readonly Pick<RosterDraft, 'work_date'>[]) => {
	const days = [...new Set(drafts.map((draft) => draft.work_date))].toSorted();
	return { from: days[0] ?? '9999-12-31', to: days.at(-1) ?? '9999-12-31' };
};

/**
 * What `rosterFindings` reads for one entity over `span`, as keyed read members named with `prefix`: the entity, its
 * lineage's versions over the span with their validations and rules, and its contracts, people, shifts, patterns and
 * published holidays. A caller folds them into its own keyed read (the import's check reads once).
 */
export const rosterMembers = (
	company_id: string,
	span: { readonly from: string; readonly to: string },
	prefix = ''
): Readonly<Record<string, JoinedMember>> => ({
	// the entity with its contracts (and their people), shifts, patterns and the span's published holidays, through
	// its relations
	[`${prefix}entity`]: {
		collection: 'entity',
		where: { id: { eq: company_id }, approval_id: { isNull: true } },
		selection: {
			...ENTITY,
			employment_contract: {
				many: { ...CONTRACT, person: { one: 'employee_id', select: PROFILE } },
				where: { approval_id: { isNull: true } }
			},
			shift_definition: { many: pick('id', 'code', 'variant') },
			shift_pattern: { many: pick('id', 'pattern', 'effective_range') },
			holiday: {
				many: HOLIDAY,
				where: { date: { gte: span.from, lte: span.to }, published_at: { isNull: false } }
			}
		}
	},
	// its lineage's versions over the span (by its code: no relation) with their validations and rules
	[`${prefix}versions`]: {
		collection: 'jurisdiction_settings',
		where: {
			code: { in: { member: `${prefix}entity`, field: 'settings_code' } },
			approval_id: { isNull: true },
			voided_at: { isNull: true },
			sealed_at: { isNull: false },
			effective_range: { overlaps: span }
		},
		selection: {
			...SETTINGS,
			rule_set: {
				many: { ...RULES, family: true },
				where: { family: { in: ['VALIDATIONS', 'PAYROLL'] } }
			}
		}
	}
});

/**
 * A roster import's days against the `roster` validations of the version governing each day, in code order. The
 * context is the subject on the day plus `rules`, `day` (a `work.days[]` day as the import would store it, with
 * `leave_code` and `rest_hours_before` = hours from the previous day's last clock-out to this day's first clock-in,
 * null when either is unrecorded) and `week` (`worked_hours`, `overtime_hours`, `worked_days` over the seven days
 * ending on the day, `overtime_hours_by_day_type.<WORK|REST|OFF|HOLIDAY>`: by the planned type, holidays again,
 * `overtime_hours_holiday_by_day_type.<WORK|REST|OFF>`: holiday overtime alone by the type the holiday fell on, and
 * `holiday_worked_hours`: the normal hours worked on holidays). Days outside the import read as unrecorded.
 */
export const rosterFindings = (company_id: string, drafts: readonly RosterDraft[]) =>
	Effect.gen(function* () {
		if (drafts.length === 0) return [];
		const got = yield* readJoinedSet(rosterMembers(company_id, draftSpan(drafts)));
		return yield* rosterFindingsFrom(company_id, drafts, got);
	});

/** `rosterFindings` over `rosterMembers`' rows (`got`, read with `prefix`). */
export const rosterFindingsFrom = (
	company_id: string,
	drafts: readonly RosterDraft[],
	answer: <T>(key: string) => readonly T[],
	prefix = ''
) =>
	Effect.gen(function* () {
		if (drafts.length === 0) return [];
		const days = [...new Set(drafts.map((draft) => draft.work_date))].toSorted();
		const got = <T>(key: string): readonly T[] => answer<T>(`${prefix}${key}`);
		const [entity] = got<EntityRow & { readonly [arm: string]: unknown }>('entity');
		if (entity == null)
			return yield* Effect.fail(
				new Refusal({ message: 'This needs an actual approved legal entity.' })
			);
		const versions = got<
			SettingsRow & {
				readonly rule_set?: readonly { code: string; rules?: Json; family?: string }[];
			}
		>('versions');
		const ruleSets = versions.flatMap((version) =>
			(version.rule_set ?? []).map((row) => ({ ...row, settings_id: version.id }))
		);
		const checksOf = new Map<string, { version: SettingsRow; checks: readonly Validation[] }>();
		const governed = new Map<string, { version: SettingsRow; checks: readonly Validation[] }>();
		for (const date of days) {
			const found = yield* Effect.result(versionOn(versions, entity.settings_code, date));
			if (Result.isFailure(found)) continue;
			const version = found.success;
			let held = checksOf.get(version.id);
			if (held == null) {
				held = {
					version,
					checks: yield* validationsOf(
						ruleSets.filter(
							(row) => row.settings_id === version.id && row.family === 'VALIDATIONS'
						),
						'roster'
					)
				};
				checksOf.set(version.id, held);
			}
			if (held.checks.length > 0) governed.set(date, held);
		}
		if (governed.size === 0) return [];
		const rules = new Map<string, DynObject>();
		for (const { version } of checksOf.values())
			rules.set(
				version.id,
				Object.fromEntries(
					ruleSets
						.filter((row) => row.settings_id === version.id && row.family === 'PAYROLL')
						.map((row) => [row.code, row.rules ?? {}])
				)
			);
		const contracts =
			(
				entity as typeof entity & {
					readonly employment_contract?: readonly (ContractRow & {
						readonly person?: EmployeeRow | null;
					})[];
				}
			).employment_contract ?? [];
		const ids = new Set(drafts.map((draft) => draft.employment_id));
		const mine = contracts.filter((contract) => ids.has(contract.id));
		const arms = entity as typeof entity & {
			readonly shift_definition?: readonly ShiftDefinitionRow[];
			readonly shift_pattern?: readonly ShiftPatternRow[];
			readonly holiday?: readonly HolidayRow[];
		};
		const employees = new Map(
			contracts.flatMap((row) =>
				row.person == null ? [] : [[row.employee_id, row.person] as const]
			)
		);
		const definitions = new Map((arms.shift_definition ?? []).map((row) => [row.id, row]));
		const patterns = new Map((arms.shift_pattern ?? []).map((row) => [row.id, row]));
		const holidays = new Map((arms.holiday ?? []).map((row) => [row.date, row]));
		const zone = zoneOf(entity, [...checksOf.values()][0]?.version);
		const out: RosterFinding[] = [];
		for (const contract of mine) {
			const own = drafts.filter((draft) => draft.employment_id === contract.id);
			const byDate = new Map(own.map((draft) => [draft.work_date, draft]));
			const rosterOn = new Map(
				own.map((draft): [string, RosterRow] => [
					draft.work_date,
					{ ...draft, id: String(draft.ref) }
				])
			);
			const planOn = dayPlanner({
				contract,
				fallback: undefined,
				roster: rosterOn,
				definitions,
				patterns
			});
			const dayOf = (date: string) =>
				workDay({
					date,
					planned: planOn(date),
					row: rosterOn.get(date),
					holiday: holidays.get(date),
					zone
				});
			const clocks = (date: string): { first: number; last: number } | null => {
				const stored = rosterOn.get(date)?.worked_intervals;
				const list = Schema.is(IntervalList)(stored) ? stored : [];
				const ends = list.flatMap((row) => (row.end == null ? [] : [Date.parse(row.end)]));
				const first = list[0] == null ? Number.NaN : Date.parse(list[0].start);
				return Number.isFinite(first) && ends.length > 0
					? { first, last: Math.max(...ends) }
					: null;
			};
			for (const draft of own.toSorted((a, b) => a.work_date.localeCompare(b.work_date))) {
				const held = governed.get(draft.work_date);
				if (held == null) continue;
				const day = dayOf(draft.work_date);
				const today = clocks(draft.work_date);
				const before = clocks(String(addDays(draft.work_date, -1)));
				const by: { [type: string]: number } = { WORK: 0, REST: 0, OFF: 0, HOLIDAY: 0 };
				const holidayBy: { [type: string]: number } = { WORK: 0, REST: 0, OFF: 0 };
				const week = {
					worked_hours: 0,
					overtime_hours: 0,
					worked_days: 0,
					overtime_hours_by_day_type: by,
					overtime_hours_holiday_by_day_type: holidayBy,
					holiday_worked_hours: 0
				};
				// The week: the 7 days ending on the day, or (`payroll.roster_week: CALENDAR`) the calendar week from
				// `payroll.week_start` through the day.
				const calendarWeek = held.version.payroll?.roster_week === 'CALENDAR';
				const span = calendarWeek
					? ((new Date(`${draft.work_date}T00:00:00Z`).getUTCDay() -
							(held.version.payroll?.week_start ?? 0) +
							7) %
							7) +
						1
					: 7;
				for (let back = 0; back < span; back++) {
					const date = String(addDays(draft.work_date, -back));
					if (!byDate.has(date)) continue;
					const other = back === 0 ? day : dayOf(date);
					week.worked_hours = round2(week.worked_hours + num(other['worked_hours']));
					week.overtime_hours = round2(week.overtime_hours + num(other['overtime_hours']));
					// By the day's planned type, and again under HOLIDAY on a published holiday.
					const type = String(other['day_type'] ?? '');
					if (type !== '') by[type] = round2((by[type] ?? 0) + num(other['overtime_hours']));
					if (String(other['holiday_kind'] ?? '') !== '') {
						by['HOLIDAY'] = round2((by['HOLIDAY'] ?? 0) + num(other['overtime_hours']));
						// A holiday's overtime by the day type it fell on, and its normal (non-overtime) hours worked.
						if (type !== '')
							holidayBy[type] = round2((holidayBy[type] ?? 0) + num(other['overtime_hours']));
						week.holiday_worked_hours = round2(
							week.holiday_worked_hours +
								Math.max(0, num(other['worked_hours']) - num(other['overtime_hours']))
						);
					}
					if (other['worked'] === true) week.worked_days++;
				}
				const term = termFor(contract, draft.work_date);
				const context: DynObject = {
					...subjectContext({
						contract,
						employee: employees.get(contract.employee_id),
						entity,
						term,
						day: draft.work_date,
						headcount: inForce(contracts, draft.work_date),
						version: held.version
					}),
					rules: rules.get(held.version.id) ?? {},
					day: {
						...day,
						leave_code: draft.leave_code,
						rest_hours_before:
							today == null || before == null
								? null
								: round2((today.first - before.last) / 3_600_000)
					},
					week
				};
				for (const check of yield* tripped(held.checks, context))
					out.push({
						ref: draft.ref,
						code: check.code,
						kind: check.kind,
						message: check.message,
						column: check.column ?? ''
					});
			}
		}
		return out;
	});

/** The values that replace a former employee's personal fields: identity, contact, family, biometrics and facts. The
 * payslips, runs and obligations keep their amounts for the books. */
export const anonymousProfile = () => ({
	name: 'Former employee',
	date_of_birth: null,
	gender: null,
	marital_status: null,
	solo_parent: false,
	disabled: false,
	receiving_pension: false,
	race: null,
	religion: null,
	spouse_status: null,
	children: [],
	nationality: null,
	identity_number: null,
	dependents_count: 0,
	email: null,
	phone: null,
	address: null,
	location: null,
	face_embedding: null,
	face_photo: null,
	face_enrollment_status: 'NONE' as const,
	face_consent_at: null,
	face_enrolled_at: null,
	face_last_match_at: null,
	face_match_count: 0,
	facts: {},
	user_id: null,
	before: {}
});

/**
 * Whether a person's records may be anonymised on `today`: every employment has ended, and the version governing each
 * exit day names a PAYROLL `record_retention` rule whose `until` CEL (on the subject at the exit: `employment.exit_date`,
 * `employment.exit_ground`, `terms`, …) returns a day on or before today. Answers the latest such day.
 */
export const admitAnonymise = (employee_id: string, today: string) =>
	Effect.gen(function* () {
		const contracts = yield* readAll<ContractRow>(
			'employment_contract',
			{ employee_id: { eq: employee_id }, approval_id: { isNull: true } },
			undefined,
			CONTRACT
		);
		const [employee] = yield* readAll<EmployeeRow>(
			'employment_profile',
			{ id: { eq: employee_id } },
			undefined,
			PROFILE
		);
		if (
			contracts.length === 0 ||
			contracts.some((row) => (row.effective_range?.to ?? today) >= today)
		)
			return yield* Effect.fail(
				new Refusal({ message: 'Only a former employee, every employment ended, is anonymised.' })
			);
		let latest = '';
		for (const contract of contracts) {
			const exit = String(contract.effective_range!.to);
			const entity = yield* entityOf(contract.company_id);
			const version = yield* governingVersion(entity, exit);
			const rule = (yield* versionRules(version))['record_retention'];
			if (!isJsonObject(rule) || !Schema.is(Schema.String)(rule['until']))
				return yield* Effect.fail(
					new Refusal({ message: `${version.code} names no record retention for ${exit}.` })
				);
			const until = yield* evaluate(
				rule['until'],
				{
					...subjectContext({
						contract,
						employee,
						entity,
						term: termFor(contract, exit),
						day: exit,
						headcount: 0,
						version
					}),
					rules: yield* versionRules(version)
				},
				`rule_set record_retention of ${version.code}`
			);
			if (!Schema.is(Schema.String)(until) || until.length < 10)
				return yield* Effect.fail(
					new Refusal({ message: `${version.code} record retention must return a date.` })
				);
			if (until.slice(0, 10) > latest) latest = until.slice(0, 10);
		}
		if (today < latest)
			return yield* Effect.fail(
				new Refusal({
					message: `The records are kept until ${latest}; anonymise on or after that day.`
				})
			);
		return latest;
	});

/** A kind the version governing `day` lists in its PAYROLL `<rule>` row (`rules.kinds[] = { code, name }`). */
const listedKind = (company_id: string, rule: string, noun: string, kind: string, day: string) =>
	Effect.gen(function* () {
		const version = yield* governingVersion(yield* entityOf(company_id), day);
		const kinds = (yield* versionRules(version))[rule];
		const listed =
			isJsonObject(kinds) && Array.isArray(kinds['kinds'])
				? kinds['kinds'].some((held) => isJsonObject(held) && held['code'] === kind)
				: false;
		if (!listed)
			return yield* Effect.fail(
				new Refusal({ message: `${version.code} lists no ${noun} ${kind} on ${day}.` })
			);
	});

/** One work suspension as written: a kind of its governing version's `suspension_kind` catalogue, ending on or after
 * it starts. */
export const admitSuspension = (input: {
	readonly company_id: string;
	readonly kind: string;
	readonly starts_on: string;
	readonly ends_on: string;
}) =>
	Effect.gen(function* () {
		if (input.ends_on < input.starts_on)
			return yield* Effect.fail(
				new Refusal({ message: 'A suspension ends on or after it starts.' })
			);
		const version = yield* governingVersion(yield* entityOf(input.company_id), input.starts_on);
		if (!(yield* suspensionKinds(version.id)).has(input.kind))
			return yield* Effect.fail(
				new Refusal({
					message: `${version.code} lists no suspension kind ${input.kind} on ${input.starts_on}.`
				})
			);
	});

/**
 * One workplace case as written: a kind the version governing its opening day lists (`rule_set` PAYROLL `case_kinds`,
 * `rules.kinds[] = { code, name }`), closed no earlier than opened, and the company of its employment when it names
 * one. Answers the case's company.
 */
export const admitCase = (input: {
	readonly company_id: Id<'entity'> | null;
	readonly employment_id: string | null;
	readonly kind: string;
	readonly opened_on: string;
	readonly closed_on: string | null;
}) =>
	Effect.gen(function* () {
		const [contract] =
			input.employment_id == null
				? []
				: yield* readAll<{ readonly id: string; readonly company_id: Id<'entity'> }>(
						'employment_contract',
						{ id: { eq: input.employment_id } },
						undefined,
						pick('id', 'company_id')
					);
		if (input.employment_id != null && contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This case needs an actual employment.' }));
		const company_id = contract?.company_id ?? input.company_id;
		if (company_id == null || (input.company_id != null && input.company_id !== company_id))
			return yield* Effect.fail(
				new Refusal({ message: 'A case belongs to its employment’s legal entity.' })
			);
		if (input.closed_on != null && input.closed_on < input.opened_on)
			return yield* Effect.fail(new Refusal({ message: 'A case closes on or after it opens.' }));
		yield* listedKind(company_id, 'case_kinds', 'case kind', input.kind, input.opened_on);
		return company_id;
	});

/**
 * What `admitEntry` reads for a batch of entries of one collection, as one read: the employments (each with its person,
 * entity, headcount and earlier entries of the family; a time-off write: as a leave subject), the picked classes, and
 * the versions of their lineages over the entries' days (by the entity's code: no relation) with their PAYROLL rules and
 * their rows of the picked classes' codes (every class, for time off).
 */
export const entryMembers = <C extends EntryCollection>(
	collection: C,
	inputs: readonly {
		readonly employment_id: string;
		readonly catalog_id: string;
		readonly occurred_on: string;
	}[]
): Readonly<Record<'employment' | 'picked' | 'versions', JoinedMember>> => {
	const family = FAMILIES.find((candidate) => candidate.collection === collection)!;
	const input = { collection };
	const leaveFamily = family.family === 'LEAVE';
	const days = inputs.map((held) => held.occurred_on).toSorted();
	const ref = (member: string, field: string) => ({ in: { member, field } });
	return {
		// the employment with its person, entity and headcount and its earlier entries of the family (a time-off
		// write: as a leave subject, every movement with its class's code and its payslip history)
		employment: {
			collection: 'employment_contract' as const,
			where: { id: { in: [...new Set(inputs.map((input) => input.employment_id))] } },
			selection: {
				...EMPLOYMENT,
				...(leaveFamily ? SUBJECT_ARMS : {}),
				[input.collection]: {
					many: {
						...ENTRY[input.collection],
						...(leaveFamily ? LEAVE_SUBJECT_ARMS.leave_catalog_entry.many : {}),
						catalog: { one: 'catalog_id', select: pick('code') }
					},
					...(leaveFamily ? {} : { where: { approval_id: { isNull: true } } })
				}
			}
		},
		picked: {
			collection: family.catalog,
			where: { id: { in: [...new Set(inputs.map((input) => input.catalog_id))] } },
			selection: CATALOG[family.catalog]
		},
		// the versions of the employment's lineage in force on the entry day (by its entity's code: no relation),
		// with their PAYROLL rules and their row of the picked class's code (every class, for a time-off write)
		versions: {
			collection: 'jurisdiction_settings' as const,
			where: {
				code: ref('employment', 'company_id.settings_code'),
				approval_id: { isNull: true },
				voided_at: { isNull: true },
				sealed_at: { isNull: false },
				effective_range: { overlaps: { from: days[0]!, to: days.at(-1)! } }
			},
			selection: {
				...SETTINGS,
				rule_set: { many: RULES, where: { family: { eq: 'PAYROLL' } } },
				[family.catalog]: leaveFamily
					? { many: { ...CATALOG[family.catalog], ...LEAVE_CLASS } }
					: { many: CATALOG[family.catalog], where: { code: ref('picked', 'code') } }
			}
		}
	};
};

/** One entry as its family's catalogue reads it: the class must belong to the version in force on the entry day. */
export const admitEntry = <C extends EntryCollection>(input: {
	readonly collection: C;
	/** The stored entry being edited, which is not its own earlier sibling. */
	readonly id?: string | null;
	readonly catalog_id: string;
	readonly employment_id: string;
	readonly occurred_on: string;
	readonly activity?: string | null;
	readonly values?: EntryColumns | null;
	/** A batch's one read (`entryMembers` over every entry of the batch); absent, the entry reads its own. */
	readonly prefetched?: <T>(key: string) => readonly T[];
}): Effect.Effect<
	{
		readonly company_id: string;
		readonly catalog_id: Id<CatalogName<C>>;
		/** The version governing the entry's day. */
		readonly version: SettingsRow;
		/** A time-off write's subject and the version's classes, read with the admission (empty for another family). */
		readonly leave: {
			readonly subject: Employment | undefined;
			readonly classes: readonly HostRow<'leave_catalog'>[];
		};
	},
	Refusal
> =>
	Effect.gen(function* () {
		const family = FAMILIES.find((candidate) => candidate.collection === input.collection)!;
		const ref = (member: string, field: string) => ({ in: { member, field } });
		// One keyed read: the employment (its person, entity, headcount and earlier entries of the family), the picked
		// class, the versions of the employment's lineage in force on the entry day, and their PAYROLL rules and row of
		// the picked class's code.
		const leaveFamily = family.family === 'LEAVE';
		// the batch's one read (`entryMembers`), else this entry's own
		const got = input.prefetched ?? (yield* readJoinedSet(entryMembers(input.collection, [input])));
		const contract = got<Employment>('employment').find((held) => held.id === input.employment_id);
		if (contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This entry needs an actual employment.' }));
		const range = contract.effective_range ?? {};
		const afterExit = range.to != null && input.occurred_on > range.to;
		if (!afterExit && !dayInRange(input.occurred_on, range))
			return yield* Effect.fail(
				new Refusal({ message: 'The entry day falls outside the employment.' })
			);
		const entity = yield* companyOf(contract);
		const version = yield* versionOn(
			got<SettingsRow>('versions').filter((held) => held.code === entity.settings_code),
			entity.settings_code,
			input.occurred_on
		);
		const armOf = <T>(name: string): readonly T[] => {
			const held: unknown = Reflect.get(version, name);
			return Array.isArray(held) ? (held as T[]) : [];
		};
		// A class is its code: the entry is pinned to that code's row in the version in force on its day.
		const picked = got<CatalogRow & { readonly id: Id<CatalogName<C>>; settings_id?: string }>(
			'picked'
		).find((held) => held.id === input.catalog_id);
		if (picked == null)
			return yield* Effect.fail(new Refusal({ message: 'Choose the entry’s class.' }));
		const governed = { rule_set: armOf<{ code: string; rules?: Json }>('rule_set') };
		const row =
			picked.settings_id === version.id
				? picked
				: armOf<CatalogRow & { readonly id: Id<CatalogName<C>> }>(family.catalog).find(
						(held) => held.code === picked.code
					);
		if (row == null)
			return yield* Effect.fail(
				new Refusal({
					message: `${picked.name ?? picked.code} is not a class of the ${version.code} version in force on ${input.occurred_on}.`
				})
			);
		// Only a class payable after exit (non-compete pay, separation instalments) takes a day past the employment.
		if (afterExit && row.payable_after_exit !== true)
			return yield* Effect.fail(
				new Refusal({ message: 'The entry day falls outside the employment.' })
			);
		const term = termFor(contract, input.occurred_on);
		const employee = contract.person ?? undefined;
		// a time-off write read every movement (its leave subject's); the earlier entries are the approved ones
		const entries = contract[input.collection];
		const earlier = Array.isArray(entries)
			? entries.filter((held) => !leaveFamily || !isJsonObject(held) || held['approval_id'] == null)
			: entries;
		const values = input.values ?? {};
		if (
			family.family !== 'LEAVE' &&
			row.amount_required !== false &&
			!(moneyValue(values.amount) > 0)
		)
			return yield* Effect.fail(new Refusal({ message: 'Enter the amount.' }));
		if (
			family.family === 'LEAVE' &&
			(input.activity ?? 'TIME_OFF') === 'TIME_OFF' &&
			!(num(values.days, 1) > 0)
		)
			return yield* Effect.fail(new Refusal({ message: 'Enter the days taken.' }));
		const context: DynObject = {
			...subjectContext({
				contract,
				employee,
				entity,
				term,
				day: input.occurred_on,
				headcount: inForce(entity.employment_contract, input.occurred_on),
				version
			}),
			rules: Object.fromEntries(
				(governed?.rule_set ?? []).map((held) => [held.code, held.rules ?? {}])
			),
			entry: entryContext(values, input.occurred_on),
			earlier: earlierContext(
				(Array.isArray(earlier)
					? (earlier as readonly (EntryRow & { readonly catalog?: { code?: string } | null })[])
					: []
				).map(({ catalog, ...held }) => ({ ...held, code: catalog?.code ?? '' })),
				{
					code: row.code,
					occurred_on: input.occurred_on,
					...(input.id == null ? {} : { id: input.id })
				}
			)
		};
		const where = `${family.catalog} ${row.code}`;
		if (!(yield* evaluateBoolean(row.eligibility, context, where)))
			return yield* Effect.fail(
				new Refusal({ message: `${row.name ?? row.code} is not available to this employment.` })
			);
		if (!(yield* evaluateBoolean(row.qualifies_when, context, where)))
			return yield* Effect.fail(
				new Refusal({ message: `This entry does not qualify as ${row.name ?? row.code}.` })
			);
		return {
			company_id: contract.company_id,
			catalog_id: row.id,
			version,
			// what the time-off check reads, from the same read (none for another family)
			leave: {
				subject: leaveFamily ? contract : undefined,
				classes: leaveFamily ? armOf<HostRow<'leave_catalog'>>('leave_catalog') : []
			}
		};
	});

/** The part of a scheme one `counts_toward` target names: `CPF.ADDITIONAL` → CPF's `additional`; a bare code → `ordinary`. */
const schemePart = (target: string): [scheme: string, part: string] => {
	const [scheme = '', part = 'ordinary'] = target.split('.');
	return [scheme, part.toLowerCase()];
};

/** Every part each scheme is paid in under one version's catalogues, `ordinary` always among them. */
type SchemeParts = ReadonlyMap<string, ReadonlySet<string>>;
const partsOf = (rows: readonly CatalogRow[]): SchemeParts => {
	const parts = new Map<string, Set<string>>();
	for (const row of rows)
		for (const target of row.counts_toward ?? []) {
			const [scheme, part] = schemePart(target);
			const held = parts.get(scheme) ?? new Set(['ordinary']);
			held.add(part);
			parts.set(scheme, held);
		}
	return parts;
};

const slipPeriod = (slip: PayslipHistoryRow): string => String(slip.salary_from ?? '').slice(0, 7);

/** One set of stored payslips summed: each line's amount by its component or catalogue code, the gross and net,
 * and each scheme's employee and employer charge and assessed base (`base`, and by wage part) under `statutory`. */
const slipSums = (slips: readonly PayslipHistoryRow[]): DynObject => {
	const lines: { [code: string]: number } = {};
	const statutory: {
		[code: string]: {
			employee: number;
			employer: number;
			base: number;
			parts: { [part: string]: number };
		};
	} = {};
	let gross = 0;
	let net = 0;
	for (const slip of slips) {
		gross += moneyValue(slip.gross);
		net += moneyValue(slip.net);
		for (const line of [...(slip.base ?? []), ...(slip.adjustments ?? [])]) {
			const code = line.component_code;
			if (code != null && code !== '')
				lines[code] = round2((lines[code] ?? 0) + moneyValue(line.amount));
		}
		for (const line of slip.statutory ?? []) {
			const code = line.scheme_code;
			if (code == null) continue;
			const held = statutory[code] ?? { employee: 0, employer: 0, base: 0, parts: {} };
			const parts = { ...held.parts };
			for (const [part, amount] of Object.entries(line.parts ?? {}))
				parts[part] = round2((parts[part] ?? 0) + num(amount));
			statutory[code] = {
				employee: round2(held.employee + num(line.employee_amount)),
				employer: round2(held.employer + num(line.employer_amount)),
				base: round2(held.base + num(line.base_amount)),
				parts
			};
		}
	}
	return { ...lines, gross: round2(gross), net: round2(net), statutory };
};

/**
 * What the employment earned before this slip, from its stored payslips: `month` (earlier slips of this period),
 * `year` (earlier periods of the calendar year),
 * `previous_month` (the previous period's salary-run slips, with the base salary of the terms then in force),
 * `months[]` (each of the 12 calendar months before this one that has a slip, oldest first, as `{ month, … }`) and
 * `history[]` (the same over the 24 months before this one).
 */
/** One month's attendance, leave by class and suspension by kind, as `earned.months[]` carries it. */
type MonthTally = {
	worked_days: number;
	worked_hours: number;
	suspended_days: number;
	leave_days: { [code: string]: number };
	suspended_days_by_kind: { [kind: string]: number };
};
const emptyTally = (): MonthTally => ({
	worked_days: 0,
	worked_hours: 0,
	suspended_days: 0,
	leave_days: {},
	suspended_days_by_kind: {}
});

const earnedFrom = (input: {
	readonly history: readonly PayslipHistoryRow[];
	readonly period: string;
	readonly runKind: ReadonlyMap<string, string>;
	readonly contract: ContractRow;
	/** Per calendar month: the days and hours attendance recorded, and the days a work suspension covered. */
	readonly worked?: ReadonlyMap<string, MonthTally>;
	/** The month the year starts in (`payroll.tax_year_start_month`, default January). */
	readonly yearStartMonth?: number;
}): DynObject => {
	const { history, period } = input;
	const previous = String(monthOf(addDays(`${period}-01`, -1)).from).slice(0, 7);
	const monthsBefore = (count: number) =>
		[...new Set(history.map(slipPeriod))]
			.filter(
				(month) => month < period && month >= String(addMonths(`${period}-01`, -count)).slice(0, 7)
			)
			.toSorted()
			.map((month) => ({
				month,
				...slipSums(history.filter((slip) => slipPeriod(slip) === month)),
				...(input.worked == null ? {} : (input.worked.get(month) ?? emptyTally()))
			}));
	const previousSlips = history.filter(
		(slip) =>
			slipPeriod(slip) === previous &&
			isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
	);
	return {
		month: slipSums(history.filter((slip) => slipPeriod(slip) === period)),
		year: slipSums(
			history.filter(
				(slip) =>
					slipPeriod(slip) >= taxYearStart(period, input.yearStartMonth) &&
					slipPeriod(slip) < period
			)
		),
		months: monthsBefore(HISTORY_MONTHS),
		// The mean of the months above that had a slip: an average monthly wage.
		average: (() => {
			const months: readonly DynObject[] = monthsBefore(HISTORY_MONTHS);
			const mean = (key: 'gross' | 'net') =>
				months.length === 0
					? 0
					: round2(months.reduce((sum, month) => sum + num(month[key]), 0) / months.length);
			return { gross: mean('gross'), net: mean('net'), months: months.length };
		})(),
		history: monthsBefore(LONG_HISTORY_MONTHS),
		previous_month: {
			...slipSums(previousSlips),
			base_salary: moneyValue(
				termFor(input.contract, String(monthOf(`${previous}-01`).to))?.base_salary
			)
		}
	};
};

/** A stored instant as local wall time `YYYY-MM-DDTHH:MM` in a zone, or null when it is not an instant. */
const localClock = (instant: unknown, zone: string): string | null => {
	const millis = Schema.is(Schema.String)(instant) ? Date.parse(instant) : Number.NaN;
	return Number.isFinite(millis)
		? toCalendarDateTime(fromAbsolute(millis, zone)).toString().slice(0, 16)
		: null;
};

const IntervalList = Schema.Array(
	Schema.Struct({ start: Schema.String, end: Schema.optional(Schema.NullOr(Schema.String)) })
);

/**
 * The planner of one employment's days: the roster entry's shift definition, else the cycle day of the pattern its
 * terms in force name (anchored at the pattern's effective start, inside its range), else none.
 */
const dayPlanner = (input: {
	readonly contract: ContractRow;
	readonly fallback: ContractTerm | undefined;
	readonly roster: ReadonlyMap<string, RosterRow>;
	readonly definitions: ReadonlyMap<string, ShiftDefinitionRow>;
	readonly patterns: ReadonlyMap<string, ShiftPatternRow>;
}) => {
	const shifts = new Map<string, PlannedShift>();
	return (date: string): PlannedShift | null => {
		const patternId = (termFor(input.contract, date) ?? input.fallback)?.shift_pattern_id;
		const pattern = patternId == null ? undefined : input.patterns.get(patternId);
		const id = plannedShiftId({
			date,
			rostered: input.roster.get(date)?.shift_definition_id ?? null,
			pattern:
				pattern == null || !dayInRange(date, pattern.effective_range ?? {})
					? null
					: { pattern: pattern.pattern, anchor: pattern.effective_range?.from ?? null }
		});
		const definition = id == null ? undefined : input.definitions.get(id);
		if (definition == null) return null;
		const held = shifts.get(definition.id) ?? plannedShift(definition);
		shifts.set(definition.id, held);
		return held;
	};
};

/** Every date from `from` to `to`, both inclusive. */
const datesFrom = (from: string, to: string): string[] => {
	const dates: string[] = [];
	for (let date = from; date <= to; date = String(addDays(date, 1))) dates.push(date);
	return dates;
};

/** A day's paid overtime: the approved hours less those banked as time off. */
const paidOvertime = (row: RosterRow | undefined): number =>
	round2(Math.max(0, num(row?.approved_overtime_hours) - num(row?.banked_overtime_hours)));

/**
 * A day clocked as one pair less the shift's planned break: the pair split around the break's window (centred on the
 * shift, local wall time in the zone), so worked hours and every interval check net it. Recorded breaks (more than
 * one interval) and a pair the window does not meet stay as they are.
 */
const netOfBreak = (
	intervals: typeof IntervalList.Type,
	date: string,
	pause: PlannedShift['break'],
	zone: string
): typeof IntervalList.Type => {
	const [only] = intervals;
	if (pause == null || intervals.length !== 1 || only?.end == null) return intervals;
	const at = (minute: number) =>
		toZoned(parseDateTime(`${date}T00:00`).add({ minutes: Math.round(minute) }), zone)
			.toDate()
			.getTime();
	const from = at(pause.from_minute);
	const to = at(pause.from_minute + pause.minutes);
	const start = Date.parse(only.start);
	const end = Date.parse(only.end);
	if (!(start < to && from < end)) return intervals;
	return [
		...(start < from ? [{ start: only.start, end: new Date(from).toISOString() }] : []),
		...(to < end ? [{ start: new Date(to).toISOString(), end: only.end }] : [])
	];
};

/** One planned and recorded person-day as the CEL root `work.days[]` reads it. */
const workDay = (input: {
	readonly date: string;
	readonly planned: PlannedShift | null;
	readonly row: RosterRow | undefined;
	readonly holiday: HolidayRow | undefined;
	readonly zone: string;
	/** The work suspension covering the day for this employment, if any. */
	readonly suspension?: SuspensionRow | undefined;
}): JsonObject => {
	const { row } = input;
	const recorded = Schema.is(IntervalList)(row?.worked_intervals) ? row.worked_intervals : [];
	const stored = netOfBreak(recorded, input.date, input.planned?.break, input.zone);
	let worked = 0;
	const intervals: { start: string; end: string | null }[] = [];
	for (const interval of stored) {
		const start = localClock(interval.start, input.zone);
		const end = interval.end == null ? null : localClock(interval.end, input.zone);
		if (start == null) continue;
		if (interval.end != null && end != null)
			worked += (Date.parse(interval.end) - Date.parse(interval.start)) / 3_600_000;
		intervals.push({ start, end });
	}
	return {
		date: input.date,
		day_type: input.planned?.day_type ?? '',
		shift_code: input.planned?.code ?? '',
		holiday_kind: input.holiday?.kind ?? '',
		holiday_name: input.holiday?.name ?? '',
		scheduled_hours: input.planned?.scheduled_hours ?? 0,
		worked_hours: round2(worked),
		/** Attendance was recorded on the day: its intervals add up to more than nothing. */
		worked: worked > 0,
		overtime_hours: paidOvertime(row),
		banked_hours: num(row?.banked_overtime_hours),
		banked_band: row?.banked_overtime_band ?? '',
		incentive_hours: num(row?.incentive_hours),
		// the day's own overtime consent (per day, never the contract's): its instant, and whether there is one
		overtime_consented_at:
			row?.overtime_consented_at == null ? null : String(row.overtime_consented_at),
		overtime_consented: row?.overtime_consented_at != null,
		worksite: row?.worksite ?? '',
		facts: isJsonObject(row?.facts) ? row.facts : {},
		suspended:
			input.suspension == null
				? null
				: {
						kind: input.suspension.kind,
						from: input.suspension.starts_on,
						to: input.suspension.ends_on,
						facts: isJsonObject(input.suspension.facts) ? input.suspension.facts : {}
					},
		intervals
	};
};

// ponytail: `hours.rolling` is a fixed three calendar months (TW's 138 h cap); a per-version span needs a record field.
const ROLLING_MONTHS = 3;

type HourSums = { worked_hours: number; overtime_hours: number; incentive_hours: number };

/**
 * The CEL root `hours`: the employment's approved roster days summed over the period's calendar `month`, the
 * `previous_month`, the calendar `year` through this month and the `rolling` months ending with it — each `worked_hours`,
 * `overtime_hours`, `incentive_hours`, and the same sums by planned `day_type` and by `holiday_kind` (absent keys absent).
 */
const hoursFrom = (input: {
	/** `payroll.rolling_hours_months`: the months `rolling` sums. */
	readonly rollingMonths?: number;
	/** The month the year starts in (`payroll.tax_year_start_month`). */
	readonly yearStartMonth?: number;
	readonly rows: readonly RosterRow[];
	readonly holidays: ReadonlyMap<string, HolidayRow>;
	readonly month: { readonly from: string; readonly to: string };
	/** The settlement period's last day: `month_to_date` runs from the 1st to it. */
	readonly through: string;
	readonly planOn: (date: string) => PlannedShift | null;
	readonly zone: string;
}): DynObject => {
	const { month } = input;
	const recorded = input.rows.map((row) => {
		const day = workDay({
			date: row.work_date,
			planned: input.planOn(row.work_date),
			row,
			holiday: input.holidays.get(row.work_date),
			zone: input.zone
		});
		return {
			date: row.work_date,
			day_type: String(day.day_type ?? ''),
			holiday_kind: String(day.holiday_kind ?? ''),
			sums: {
				worked_hours: num(day.worked_hours),
				// Overtime worked, banked or paid: the caps count it either way.
				overtime_hours: round2(num(day.overtime_hours) + num(day.banked_hours)),
				incentive_hours: num(day.incentive_hours)
			}
		};
	});
	const add = (held: HourSums | undefined, sums: HourSums): HourSums => ({
		worked_hours: round2((held?.worked_hours ?? 0) + sums.worked_hours),
		overtime_hours: round2((held?.overtime_hours ?? 0) + sums.overtime_hours),
		incentive_hours: round2((held?.incentive_hours ?? 0) + sums.incentive_hours)
	});
	const windows: { [name: string]: readonly [string, string] } = {
		month: [month.from, month.to],
		// A part of the month (a semi-monthly half) reads the month to its own end, earlier parts included.
		month_to_date: [month.from, input.through],
		previous_month: [String(addMonths(month.from, -1)), String(addDays(month.from, -1))],
		year: [`${taxYearStart(month.from.slice(0, 7), input.yearStartMonth)}-01`, month.to],
		rolling: [String(addMonths(month.from, 1 - (input.rollingMonths ?? ROLLING_MONTHS))), month.to]
	};
	// One span's sums: in all, by planned day type (a published holiday again under `HOLIDAY`) and by holiday kind.
	const sumsOver = (days: typeof recorded) => {
		let total: HourSums = { worked_hours: 0, overtime_hours: 0, incentive_hours: 0 };
		const day_type: { [type: string]: HourSums } = {};
		const holiday_kind: { [kind: string]: HourSums } = {};
		for (const day of days) {
			total = add(total, day.sums);
			if (day.day_type !== '') day_type[day.day_type] = add(day_type[day.day_type], day.sums);
			if (day.holiday_kind !== '') {
				holiday_kind[day.holiday_kind] = add(holiday_kind[day.holiday_kind], day.sums);
				day_type['HOLIDAY'] = add(day_type['HOLIDAY'], day.sums);
			}
		}
		return { ...total, day_type, holiday_kind };
	};
	const out: DynObject = {};
	for (const [name, [from, to]] of Object.entries(windows))
		out[name] = sumsOver(recorded.filter((day) => day.date >= from && day.date <= to));
	// One entry per calendar month of the last year, this month last: a record's own window (an agreement year
	// from April, a 6-month average) sums the months it names.
	out.months = Array.from({ length: HISTORY_MONTHS }, (_, i) => {
		const key = String(addMonths(month.from, i + 1 - HISTORY_MONTHS)).slice(0, 7);
		return { month: key, ...sumsOver(recorded.filter((day) => day.date.startsWith(key))) };
	});
	return out;
};

/** The earliest roster day `hours` reads for a period starting on `from`: the first of `hours.months`. */
const hoursStart = (from: string): string =>
	String(addMonths(String(monthOf(from).from), 1 - HISTORY_MONTHS));

// ponytail: `attendance` reads the 24 months before the day read (a previous service year); a longer one needs more.
const ATTENDANCE_MONTHS = 24;

/**
 * The employment's days from 24 months before `asOf` (or its start) through `asOf`, as the leave entitlement's
 * `attendance` root counts them: the planned day type (the roster's shift, else the pattern of the terms in force),
 * recorded attendance, a published holiday, and the codes of the approved time off covering the day — each movement
 * named by its own class's code, whatever version captured it.
 */
const attendanceDays = (
	contract: ContractRow,
	asOf: string,
	context: DynObject,
	zone: string = PAYROLL_TIME_ZONE,
	/** The version governing `asOf` (its suspension kinds), when the caller holds it. */
	governing?: SettingsRow
) =>
	Effect.gen(function* () {
		const from = [String(addMonths(asOf, -ATTENDANCE_MONTHS)), contract.effective_range?.from ?? '']
			.toSorted()
			.at(-1)!;
		const to = [asOf, contract.effective_range?.to ?? asOf].toSorted()[0]!;
		if (from > to) return [];
		// One read: the days, the time off with its classes' codes, and the entity's calendar over the window.
		const [held] = yield* readJoined<{
			readonly roster_entry: readonly RosterRow[];
			readonly leave_catalog_entry: readonly (EntryRow & {
				readonly catalog?: { readonly code?: string } | null;
			})[];
			readonly company: {
				readonly shift_definition: readonly ShiftDefinitionRow[];
				readonly shift_pattern: readonly ShiftPatternRow[];
				readonly holiday: readonly HolidayRow[];
				readonly work_suspension: readonly SuspensionRow[];
			} | null;
		}>(
			'employment_contract',
			{ id: { eq: contract.id } },
			{
				id: true,
				roster_entry: {
					many: ROSTER,
					where: { approval_id: { isNull: true }, work_date: { gte: from, lte: to } }
				},
				leave_catalog_entry: {
					many: {
						...pick('id', 'catalog_id', 'occurred_on', 'days', 'from', 'to'),
						catalog: { one: 'catalog_id', select: pick('code') }
					},
					where: { approval_id: { isNull: true }, activity: { eq: 'TIME_OFF' } }
				},
				company: {
					one: 'company_id',
					select: {
						id: true,
						shift_definition: { many: pick('id', 'code', 'variant') },
						shift_pattern: { many: pick('id', 'pattern', 'effective_range') },
						holiday: {
							many: HOLIDAY,
							where: { date: { gte: from, lte: to }, published_at: { isNull: false } }
						},
						work_suspension: {
							many: pick('kind', 'starts_on', 'ends_on', 'worksite', 'employment_ids', 'facts'),
							where: {
								approval_id: { isNull: true },
								starts_on: { lte: to },
								ends_on: { gte: from }
							}
						}
					}
				}
			}
		);
		const roster = held?.roster_entry ?? [];
		const definitions = new Map(
			(held?.company?.shift_definition ?? []).map((row) => [row.id, row])
		);
		const patterns = new Map((held?.company?.shift_pattern ?? []).map((row) => [row.id, row]));
		const holidays = new Set((held?.company?.holiday ?? []).map((holiday) => holiday.date));
		const leave = held?.leave_catalog_entry ?? [];
		const codes = new Map(leave.map((row) => [String(row.catalog_id), row.catalog?.code ?? '']));
		const suspensions = held?.company?.work_suspension ?? [];
		const kinds =
			suspensions.length === 0
				? new Map<string, SuspensionKind>()
				: yield* suspensionKinds(
						(governing ?? (yield* governingVersion(yield* entityOf(contract.company_id), asOf))).id
					);
		const covered = leave.flatMap((row) => {
			const range = coverageRange(row.from, row.to, num(row.days, 1), row.occurred_on);
			return range == null || range.to < from
				? []
				: [{ range, code: codes.get(String(row.catalog_id)) ?? '' }];
		});
		const rosterOn = new Map(roster.map((row) => [row.work_date, row]));
		const planOn = dayPlanner({
			contract,
			fallback: termFor(contract, to),
			roster: rosterOn,
			definitions,
			patterns
		});
		const out: AttendanceDay[] = [];
		for (const date of datesFrom(from, to)) {
			const planned = planOn(date);
			const day = workDay({
				date,
				planned,
				row: rosterOn.get(date),
				holiday: undefined,
				zone
			});
			const row = rosterOn.get(date);
			const suspension = suspensionOn(
				suspensions,
				contract.id,
				date,
				worksiteOn(row, termFor(contract, date))
			);
			const work = planned?.day_type === 'WORK';
			// A suspended day counts and schedules as its kind's CEL says.
			const effect =
				suspension == null
					? { counts_as_attended: false, scheduled: true }
					: yield* suspendedDay(kinds.get(suspension.kind), {
							...context,
							day: { date, worked: day.worked === true, day_type: planned?.day_type ?? '' },
							suspension: {
								kind: suspension.kind,
								facts: isJsonObject(suspension.facts) ? suspension.facts : {}
							}
						});
			out.push({
				date,
				scheduled: work && effect.scheduled,
				worked: work && effect.scheduled && (day.worked === true || effect.counts_as_attended),
				holiday: holidays.has(date),
				banked_hours: num(row?.banked_overtime_hours),
				banked_band: row?.banked_overtime_band ?? '',
				...(suspension == null
					? {}
					: {
							suspended: suspension.kind,
							suspension: {
								kind: suspension.kind,
								from: suspension.starts_on,
								to: suspension.ends_on
							}
						}),
				leave: covered
					.filter(({ range }) => range.from <= date && date <= range.to)
					.map(({ code }) => code)
			});
		}
		return out;
	});

/**
 * The subject a leave entitlement is read on, for one employment at one day: the person, the company, the terms in
 * force, the employment and what it earned (`earned`) — and the employment's start for service-year windows. With
 * `attendance`, also its days (`attendanceDays`) for a class that reads the `attendance` root.
 */
export const leaveSubject = (
	employment_id: string,
	asOf: string,
	attendance = false,
	/** The version governing `asOf`, when the caller holds it; else it is read. */
	governing?: SettingsRow,
	/** The employment read with `SUBJECT_ARMS`, when the caller holds it; else it is read. */
	preloaded?: Employment
) =>
	Effect.gen(function* () {
		const contract = preloaded ?? (yield* employmentOf(employment_id, SUBJECT_ARMS));
		if (contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This entry needs an actual employment.' }));
		const entity = contract.company ?? undefined;
		const employee = contract.person ?? undefined;
		const slips = Array.isArray(contract['payslip'])
			? (contract['payslip'] as readonly (PayslipHistoryRow & {
					readonly run?: { readonly id?: string; readonly kind?: string } | null;
				})[])
			: [];
		const history = slips.map(({ run: _run, ...slip }) => slip);
		const runs = slips.flatMap((slip) =>
			slip.run?.id == null ? [] : [{ id: slip.run.id, kind: slip.run.kind }]
		);
		// The version governing the day: its tax year, monthly wage and zone shape the entitlement context.
		const found =
			governing ??
			(entity == null
				? undefined
				: yield* Effect.option(governingVersion(entity, asOf)).pipe(
						Effect.map((held) => (held._tag === 'Some' ? held.value : undefined))
					));
		const context: DynObject = {
			...subjectContext({
				contract,
				employee,
				entity,
				term: termFor(contract, asOf),
				day: asOf,
				headcount: inForce(entity?.employment_contract ?? [], asOf),
				version: found
			}),
			// the governing version's PAYROLL rule tables (a region table: `rules.regions.by_region[company.region]`)
			rules: payrollRules(found),
			earned: earnedFrom({
				history,
				period: asOf.slice(0, 7),
				runKind: new Map(runs.map((run) => [run.id, run.kind ?? ''])),
				contract,
				yearStartMonth: found?.payroll?.tax_year_start_month ?? 1
			})
		};
		const days: readonly AttendanceDay[] | undefined = attendance
			? yield* attendanceDays(
					contract,
					asOf,
					context,
					entity == null ? PAYROLL_TIME_ZONE : zoneOf(entity, found),
					found
				)
			: undefined;
		return { context, employmentStart: contract.effective_range?.from ?? null, days };
	});

/**
 * What `leaveState` reads for many employments at once, as one read: each employment as a leave subject with its
 * movements (each with its class's code), and the versions of their lineages over the days (by the entity's code: no
 * relation) with their classes.
 */
export const leaveStateMembers = (
	wants: readonly { readonly employment_id: string; readonly asOf: string }[]
): Readonly<Record<'employment' | 'versions', JoinedMember>> => {
	const days = wants.map((want) => want.asOf).toSorted();
	const ref = (member: string, field: string) => ({ in: { member, field } });
	return {
		employment: {
			collection: 'employment_contract' as const,
			where: { id: { in: [...new Set(wants.map((want) => want.employment_id))] } },
			selection: {
				...EMPLOYMENT,
				...SUBJECT_ARMS,
				leave_catalog_entry: {
					many: {
						...pick(
							'id',
							'catalog_id',
							'employment_id',
							'activity',
							'occurred_on',
							'approval_id',
							'days',
							'from',
							'to',
							'facts',
							'reference',
							'payslip_id'
						),
						catalog: { one: 'catalog_id', select: pick('code') }
					}
				}
			}
		},
		versions: {
			collection: 'jurisdiction_settings' as const,
			where: {
				code: ref('employment', 'company_id.settings_code'),
				approval_id: { isNull: true },
				voided_at: { isNull: true },
				sealed_at: { isNull: false },
				effective_range: { overlaps: { from: days[0]!, to: days.at(-1)! } }
			},
			selection: { ...SETTINGS, ...PAYROLL_RULES, leave_catalog: { many: LEAVE_CLASS } }
		}
	};
};

/**
 * One employment's leave state on a day: the leave classes of the version in force, every movement of the employment,
 * its length of service and the entitlement subject. Leave balances, previews and the exit encashment read it; a batch
 * passes `prefetched` (`leaveStateMembers` over all its employments) and reads once.
 */
export const leaveState = (
	employment_id: string,
	asOf: string,
	prefetched?: <T>(key: string) => readonly T[]
) =>
	Effect.gen(function* () {
		const got = prefetched ?? (yield* readJoinedSet(leaveStateMembers([{ employment_id, asOf }])));
		const contract = got<Employment>('employment').find((held) => held.id === employment_id);
		if (contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This entry needs an actual employment.' }));
		const company = yield* companyOf(contract);
		const version = yield* versionOn(
			got<SettingsRow>('versions').filter((held) => held.code === company.settings_code),
			company.settings_code,
			asOf
		);
		const listed: unknown = Reflect.get(version, 'leave_catalog');
		const classes = (Array.isArray(listed) ? listed : []) as readonly HostRow<'leave_catalog'>[];
		const coded = Array.isArray(contract['leave_catalog_entry'])
			? (contract['leave_catalog_entry'] as readonly (HostRow<'leave_catalog_entry'> & {
					readonly catalog?: { readonly code?: string } | null;
				})[])
			: [];
		const movements = coded.map(({ catalog: _catalog, ...row }) => row);
		const parsed = classes.map(classFromRow);
		const codeOf = new Map(
			coded.flatMap((row) =>
				row.catalog?.code == null ? [] : [[String(row.catalog_id), row.catalog.code] as const]
			)
		);
		const subject = yield* leaveSubject(
			employment_id,
			asOf,
			parsed.some(readsAttendance),
			version,
			contract
		);
		return {
			asOf,
			context: subject.context,
			employmentStart: subject.employmentStart,
			...(subject.days === undefined ? {} : { attendanceDays: subject.days }),
			classes: parsed,
			movements: movementsByCode(movements.map(movementFromRow), parsed, codeOf),
			serviceMonths: serviceMonthsAt(
				contract.effective_range?.from ?? null,
				asOf,
				contract.prior_service_months
			)
		};
	});

/** Assemble one payroll run and its payslips from the records in force; nothing is written here. */
/** `admitted`: the request's own admission when the caller already ran it (each read is a crossing). */
export const buildPayrollRun = (
	request: PayrollRunRequest,
	admitted?: Effect.Success<ReturnType<typeof admitPayrollRun>>
): Effect.Effect<PayrollPlan, Refusal> =>
	Effect.gen(function* () {
		const {
			entity,
			version,
			settlement,
			salaryRun,
			sources,
			runs,
			lineage,
			governedRows,
			switched
		} = admitted ?? (yield* admitPayrollRun(request));
		const window = payrollWindow(
			settlement,
			CYCLES.includes(entity.pay_frequency ?? '') ? 1 : (entity.pay_cutoff_day ?? 1)
		);
		const currency = version.payroll?.currency;
		if (currency == null || currency === '')
			return yield* Effect.fail(
				new Refusal({ message: `${version.code} names no payroll currency.` })
			);
		const money = roundTo(version.payroll?.minor_units ?? currencyScale(currency));
		// The version with every catalogue row the build prices from: read with the admission (the month's versions),
		// else here, once.
		const governed =
			(governedRows ?? []).find((held) => held.id === version.id) ??
			(yield* readJoined<Governed>(
				'jurisdiction_settings',
				{ id: { eq: version.id } },
				GOVERNED
			))[0];
		const catalogue = (name: string): readonly CatalogRow[] => {
			const rows = governed?.[name];
			return Array.isArray(rows) ? rows : [];
		};
		const ruleRows = governed?.rule_set ?? [];
		const rules = Object.fromEntries(
			ruleRows.filter((row) => row.family === 'PAYROLL').map((row) => [row.code, row.rules ?? {}])
		);
		const validations = yield* validationsOf(
			ruleRows.filter((row) => row.family === 'VALIDATIONS'),
			'payslip'
		);
		// The pay day: the request's, else the version's `payroll.pay_date` CEL on the period and company.
		const payDate =
			request.pay_due_date ??
			(version.payroll?.pay_date == null
				? window.salary_to
				: String(
						yield* evaluate(
							version.payroll.pay_date,
							{
								period: {
									key: request.period,
									from: window.salary_from,
									to: window.salary_to,
									part: settlement.part,
									parts: settlement.parts
								},
								company: {
									region: entity.region ?? '',
									pay_frequency: entity.pay_frequency ?? '',
									facts: isDynObject(entity.facts) ? entity.facts : {}
								}
							},
							`${version.code} payroll.pay_date`
						)
					).slice(0, 10));
		const periodRows = governed?.statutory_contribution_catalog ?? [];
		// A scheme `governed_by: "pay_date"` is assessed on its row of the version in force on the pay day (a
		// withholding table that follows the payment, not the work period); no version that day keeps the period's.
		const payVersion = periodRows.some((row) => row.configuration?.governed_by === 'pay_date')
			? yield* Effect.result(versionOn(lineage, entity.settings_code, payDate))
			: undefined;
		const payVersionId =
			payVersion == null || Result.isFailure(payVersion) || payVersion.success.id === version.id
				? undefined
				: payVersion.success.id;
		// A statutory standing names one version's scheme row; every version of the lineage maps its row ids to the code.
		const schemeCodes = new Map(
			lineage.flatMap((held) =>
				held.statutory_contribution_catalog.map((row) => [row.id, row.code] as const)
			)
		);
		const workRows = catalogue('work_catalog');
		const allowanceRows = catalogue('allowance_catalog');
		const governingRows: CatalogRow[] = [
			...workRows,
			...allowanceRows,
			...FAMILIES.flatMap((family) => catalogue(family.catalog))
		];
		// One roster and one holiday read serve the attendance window and `hours`: every approved roster day, paid or not,
		// from January (or the rolling window's start) through the month's end.
		const attended = (day: string) => day >= window.attendance_from && day <= window.attendance_to;
		const monthEnd = String(monthOf(window.salary_from).to);
		// `earned.*.worked_days`/`suspended_days` reach the 24 months of `earned.history`: the same reads, a longer span.
		// ponytail: judged on the period's scheme rows; a pay-day row reading attendance the period's does not is unseen
		const readsWorked = /worked_days|worked_hours|suspended_days|leave_days/.test(
			JSON.stringify([governingRows, periodRows, validations, rules])
		);
		const span = {
			gte: [
				readsWorked
					? String(addMonths(String(monthOf(window.salary_from).from), -LONG_HISTORY_MONTHS))
					: hoursStart(window.salary_from),
				window.attendance_from
			].toSorted()[0]!,
			lte: [monthEnd, window.attendance_to].toSorted()[1]!
		};
		// Suspensions are read only when a record of the version reads `suspended`.
		const readsSuspended = JSON.stringify([governingRows, periodRows, validations, rules]).includes(
			'suspended'
		);
		// One read: the entity's calendar and every contract in force with its person, entries and roster days. Each
		// entry carries its class's code (`catalog`), whatever version holds that class.
		const coded = { catalog: { one: 'catalog_id', select: pick('code') } } as const;
		type Coded = { readonly catalog?: { readonly code?: string } | null };
		type Joined = ContractRow & {
			readonly person: EmployeeRow | null;
			readonly roster_entry: readonly RosterRow[];
		} & { readonly [family: string]: unknown };
		// One keyed read: the entity's calendar, every contract in force with its person, entries and roster days (each
		// entry with its class's code, whatever version holds that class), their payslip history, the pay day's scheme
		// rows and every allowance class of the lineage by id (a contract allowance names the row it was captured under).
		const read = yield* readJoinedSet({
			company: {
				collection: 'entity',
				where: { id: { eq: request.company_id } },
				selection: {
					id: true,
					// every contract in force, through the relation
					employment_contract: {
						where: { approval_id: { isNull: true } },
						many: {
							...CONTRACT,
							person: { one: 'employee_id', select: PROFILE },
							roster_entry: {
								many: ROSTER,
								where: { approval_id: { isNull: true }, work_date: span }
							},
							// its payslip history (`earned`), through the relation
							payslip: { many: HISTORY },
							// Every entry of each family, paid or not: a class reads the employment's earlier ones (`earlier`);
							// every time-off movement, approved or not: absence events and leave chains.
							...Object.fromEntries(
								FAMILIES.map((family) => [
									family.collection,
									family.family === 'LEAVE'
										? { many: { ...ENTRY[family.collection], approval_id: true, ...coded } }
										: {
												many: { ...ENTRY[family.collection], ...coded },
												where: { approval_id: { isNull: true } }
											}
								])
							)
						}
					},
					holiday: { many: HOLIDAY, where: { date: span, published_at: { isNull: false } } },
					shift_definition: { many: pick('id', 'code', 'variant') },
					shift_pattern: { many: pick('id', 'pattern', 'effective_range') },
					...(readsSuspended
						? {
								work_suspension: {
									many: pick('kind', 'starts_on', 'ends_on', 'worksite', 'employment_ids', 'facts'),
									where: {
										approval_id: { isNull: true },
										starts_on: { lte: span.lte },
										ends_on: { gte: span.gte }
									}
								}
							}
						: {})
				}
			},
			// the pay day's version with its scheme rows, through the relation, when one governs a scheme
			...(payVersionId === undefined
				? {}
				: {
						pay_version: {
							collection: 'jurisdiction_settings' as const,
							where: { id: { eq: payVersionId } },
							selection: { id: true, statutory_contribution_catalog: { many: STATUTORY } }
						}
					})
		});
		const [company] = read<{
			readonly employment_contract: readonly Joined[];
			readonly holiday: readonly HolidayRow[];
			readonly shift_definition: readonly ShiftDefinitionRow[];
			readonly shift_pattern: readonly ShiftPatternRow[];
			readonly work_suspension: readonly SuspensionRow[];
		}>('company');
		const payRows =
			read<{ readonly statutory_contribution_catalog?: readonly StatutoryRow[] }>('pay_version')[0]
				?.statutory_contribution_catalog ?? [];
		const statutoryRows = periodRows.map((row) =>
			row.configuration?.governed_by === 'pay_date'
				? (payRows.find((other) => other.code === row.code) ?? row)
				: row
		);
		const joined = company?.employment_contract ?? [];
		const contracts: readonly ContractRow[] = joined;
		const contractIds = contracts.map((contract) => contract.id);
		const byEmployee = new Map(
			joined.flatMap((contract): [string, EmployeeRow][] =>
				contract.person == null ? [] : [[contract.employee_id, contract.person]]
			)
		);
		const familyRows = (collection: EntryCollection) =>
			joined.flatMap((contract) => {
				const rows = contract[collection];
				return Array.isArray(rows) ? (rows as readonly (EntryRow & LeaveEventRow & Coded)[]) : [];
			});
		// A contract allowance names the class of the version it was captured under: one read maps every such id
		// to its code for the whole run (a read per slip would spend the transform's crossings).
		const governingAllowances = new Set(allowanceRows.map((row) => row.id));
		const capturedAllowanceIds = [
			...new Set(
				contracts
					.flatMap((contract) => contract.facts?.contract_terms ?? [])
					.flatMap((term) => term.allowances ?? [])
					.map((line) => line.catalogue_id)
					.filter((id): id is string => id != null && !governingAllowances.has(id))
			)
		];
		const captured = new Set(capturedAllowanceIds);
		const lineageAllowances = lineage
			.flatMap((held) => {
				const listed: unknown = Reflect.get(held, 'allowance_catalog');
				return (Array.isArray(listed) ? listed : []) as readonly { id: string; code: string }[];
			})
			.filter((row) => captured.has(row.id));
		// a class captured outside the lineage (the contract's earlier entity) is read by id, once for the run
		const outside = capturedAllowanceIds.filter(
			(id) => !lineageAllowances.some((row) => row.id === id)
		);
		const capturedAllowanceCodes = new Map(
			[
				...lineageAllowances,
				...(outside.length === 0
					? []
					: yield* readAll<{ id: string; code: string }>(
							'allowance_catalog',
							{ id: { in: outside } },
							undefined,
							pick('id', 'code')
						))
			].map((row) => [row.id, row.code])
		);
		// Entries name their class by the row of the version they were captured under; the governing version prices it by code.
		const entries = new Map<string, readonly EntryRow[]>();
		const siblings = new Map<string, readonly EarlierRow[]>();
		const classes = new Map<string, CatalogRow>();
		const leaveCodes = new Map<string, string>();
		const strip = <R extends Coded>({ catalog: _catalog, ...row }: R) => row;
		const timeOff: LeaveEventRow[] = [];
		for (const family of FAMILIES) {
			const all = familyRows(family.collection);
			const leave = family.family === 'LEAVE';
			if (leave) timeOff.push(...all.filter((row) => row.activity === 'TIME_OFF').map(strip));
			entries.set(
				family.collection,
				all
					.filter(
						(row) =>
							row.approval_id == null &&
							// An off-cycle slip prices no leave but reads the period's rows, settled or not.
							(!(salaryRun || !leave) || row.payslip_id == null)
					)
					.map(strip)
			);
			if (!leave)
				siblings.set(
					family.collection,
					all.map((row) => ({ ...strip(row), code: row.catalog?.code ?? '' }))
				);
			const byCode = new Map(catalogue(family.catalog).map((row) => [row.code, row]));
			for (const row of all) {
				const code = row.catalog?.code;
				if (row.catalog_id == null || code == null) continue;
				if (leave) leaveCodes.set(row.catalog_id, code);
				const priced = byCode.get(code);
				if (priced != null) classes.set(row.catalog_id, priced);
			}
		}
		const rosterRead = joined.flatMap((contract) => contract.roster_entry);
		const roster = !salaryRun
			? []
			: rosterRead.filter((row) => row.payslip_id == null && attended(row.work_date));
		const hoursRoster = rosterRead.filter((row) => row.work_date <= monthEnd);
		const holidayRead = company?.holiday ?? [];
		const holidays = !salaryRun ? [] : holidayRead.filter((holiday) => attended(holiday.date));
		const hoursHolidays = new Map(holidayRead.map((holiday) => [holiday.date, holiday]));
		const history = joined.flatMap((contract) =>
			Array.isArray(contract['payslip'])
				? (contract['payslip'] as readonly PayslipHistoryRow[])
				: []
		);
		const definitions = new Map((company?.shift_definition ?? []).map((row) => [row.id, row]));
		const patterns = new Map((company?.shift_pattern ?? []).map((row) => [row.id, row]));
		// An absence event's first day, across every movement of the event: a row's month of the event counts from it.
		const eventStart = new Map<string, string>();
		const chainFrom = chainStarts(
			timeOff.map((row) => ({
				id: String(row.id),
				key: `${row.employment_id}:${leaveCodes.get(String(row.catalog_id)) ?? ''}`,
				from: String(row.from ?? row.occurred_on ?? ''),
				to: String(row.to ?? row.from ?? row.occurred_on ?? '')
			}))
		);
		const suspensions = company?.work_suspension ?? [];
		const kinds = new Map<string, SuspensionKind>(
			suspensions.length === 0
				? []
				: (governed?.suspension_kind ?? []).map((row) => [row.code, row] as const)
		);
		for (const row of timeOff) {
			const event = eventIdOf(row.facts);
			const day = String(row.from ?? row.occurred_on ?? '');
			if (event == null || day === '') continue;
			const key = `${row.employment_id}:${event}`;
			const held = eventStart.get(key);
			if (held == null || day < held) eventStart.set(key, day);
		}
		const runKind = new Map(runs.map((run) => [run.id, run.kind ?? '']));
		// each salary run's settlement window: a paid period an exit since moved or undone is repriced over its days
		const runWindows = new Map(
			runs.flatMap((run) =>
				run.salary_from == null || run.salary_to == null || !isSalaryRun(run.kind)
					? []
					: [
							[
								run.id,
								{
									from: String(run.salary_from).slice(0, 10),
									to: String(run.salary_to).slice(0, 10)
								}
							] as const
						]
			)
		);
		const exitClasses = catalogue('adhoc_catalog').filter((row) => row.raise_on_exit === true);
		const notes: string[] = [];
		const selected = new Set(sources);
		const parts = partsOf(governingRows);
		const payslips: PayslipPlan[] = [];
		for (const contract of contracts) {
			const planned = yield* buildPayslip({
				contract,
				employee: byEmployee.get(contract.employee_id),
				entity,
				version,
				rules,
				statutoryRows,
				schemeCodes,
				workRows,
				allowanceRows,
				capturedAllowanceCodes,
				classes,
				entries: FAMILIES.map((family) => ({
					...family,
					rows: (entries.get(family.collection) ?? []).filter(
						(row) => row.employment_id === contract.id
					),
					siblings: (siblings.get(family.collection) ?? []).filter(
						(row) => row.employment_id === contract.id
					)
				})),
				roster: roster.filter((row) => row.employment_id === contract.id),
				holidays,
				hoursRoster: hoursRoster.filter((row) => row.employment_id === contract.id),
				readsWorked,
				hoursHolidays,
				currency,
				period: request.period,
				settlement,
				headcount: inForce(contracts, window.salary_to),
				salaryRun,
				selected,
				window,
				parts,
				history: history.filter((slip) => slip.employment_id === contract.id),
				runKind,
				runWindows,
				exitClasses,
				notes,
				definitions,
				patterns,
				eventStart,
				money,
				timeOff,
				leaveCodes,
				chainFrom,
				suspensions,
				kinds,
				validations,
				payDate,
				assessesWithoutWage: statutoryRows.some(
					(row) => row.configuration?.assess_without_wage === true
				),
				switched,
				monthLeave: familyRows('leave_catalog_entry')
					.filter((row) => row.employment_id === contract.id && row.approval_id == null)
					.map(strip)
			});
			if (planned != null) payslips.push(planned);
		}
		return {
			run: {
				company_id: request.company_id,
				settings_id: version.id,
				period: request.period,
				kind: request.kind,
				sources,
				configuration_hash: stableJson({
					settings: version.id,
					statutory: statutoryRows.map((row) => [row.code, row.configuration ?? null]),
					work: workRows.map((row) => [row.code, row.quantity, row.rate, row.counts_toward ?? null])
				}),
				pay_date: payDate,
				pay_due_date: request.pay_due_date ?? payDate,
				salary_from: window.salary_from,
				salary_to: window.salary_to,
				attendance_from: window.attendance_from,
				attendance_to: window.attendance_to
			},
			payslips,
			warnings: [...notes, ...payslips.flatMap((slip) => slip.warnings)]
		};
	});

const buildPayslip = (options: {
	readonly contract: ContractRow;
	readonly employee: EmployeeRow | undefined;
	readonly entity: EntityRow;
	readonly version: SettingsRow;
	readonly rules: DynObject;
	readonly statutoryRows: readonly StatutoryRow[];
	readonly schemeCodes: ReadonlyMap<string, string>;
	readonly workRows: readonly CatalogRow[];
	readonly allowanceRows: readonly CatalogRow[];
	/** Every contract allowance's captured class id outside the governing version, to its code. */
	readonly capturedAllowanceCodes: ReadonlyMap<string, string>;
	readonly classes: ReadonlyMap<string, CatalogRow>;
	readonly entries: readonly {
		readonly collection: (typeof FAMILIES)[number]['collection'];
		readonly family: string;
		readonly rows: readonly EntryRow[];
		readonly siblings: readonly EarlierRow[];
	}[];
	readonly roster: readonly RosterRow[];
	readonly holidays: readonly HolidayRow[];
	/** The roster days and published holidays `hours` sums: January (or the rolling start) to the month's end. */
	readonly hoursRoster: readonly RosterRow[];
	readonly hoursHolidays: ReadonlyMap<string, HolidayRow>;
	/** A record reads `earned.*.worked_days` (or hours, or suspended days): each month's are tallied. */
	readonly readsWorked: boolean;
	readonly currency: string;
	readonly period: string;
	readonly settlement: SettlementPeriod;
	/** The entity's contracts in force on the period's last day. */
	readonly headcount: number;
	readonly salaryRun: boolean;
	readonly selected: ReadonlySet<string>;
	readonly window: {
		salary_from: string;
		salary_to: string;
		attendance_from: string;
		attendance_to: string;
	};
	readonly parts: SchemeParts;
	readonly history: readonly PayslipHistoryRow[];
	readonly runKind: ReadonlyMap<string, string>;
	/** Each salary run's settlement window, by run id. */
	readonly runWindows: ReadonlyMap<string, { readonly from: string; readonly to: string }>;
	/** The governing ad hoc classes flagged `raise_on_exit`. */
	readonly exitClasses: readonly CatalogRow[];
	/** The run's own warnings, for what a slip that is not kept still flags (a leaver's overpayment). */
	readonly notes: string[];
	readonly definitions: ReadonlyMap<string, ShiftDefinitionRow>;
	readonly patterns: ReadonlyMap<string, ShiftPatternRow>;
	readonly eventStart: ReadonlyMap<string, string>;
	/** Money to the payroll currency's minor units (or the version's `payroll.minor_units`). */
	readonly money: (value: number) => number;
	/** Every time-off movement of the run's employments, and each captured leave class's code. */
	readonly timeOff: readonly LeaveEventRow[];
	readonly leaveCodes: ReadonlyMap<string, string>;
	/** Each leave row's chain start: the first day of the back-to-back rows of its class it continues. */
	readonly chainFrom: ReadonlyMap<string, string>;
	readonly suspensions: readonly SuspensionRow[];
	/** The version's suspension catalogue: each kind's CEL decides what a suspended day does. */
	readonly kinds: ReadonlyMap<string, SuspensionKind>;
	readonly validations: readonly Validation[];
	/** The run's pay day: `period.pay_date`. */
	readonly payDate: string;
	/** A statutory row of the version charges a month with no wage (`assess_without_wage`): keep a zero-wage slip. */
	readonly assessesWithoutWage: boolean;
	/** The month is paid at more than one frequency: each contract line settles the month to date. */
	readonly switched: boolean;
	/** Every approved leave row of the employment, settled or not: a switched month's month-to-date leave. */
	readonly monthLeave: readonly EntryRow[];
}): Effect.Effect<PayslipPlan | null, Refusal> =>
	Effect.gen(function* () {
		const { contract, employee, period, window, salaryRun, money } = options;
		const who = employee?.name ?? contract.id;
		// Month-to-date (earned, statutory) is per calendar month; the settlement period may be a part of it.
		const calendar = monthOf(window.salary_from);
		const monthKey = window.salary_from.slice(0, 7);
		const periodParts = {
			part: options.settlement.part,
			parts: options.settlement.parts,
			month_key: monthKey,
			// the calendar month is paid at more than one frequency: a rule settles it month to date, as the engine does
			switched: options.switched,
			month_from: String(calendar.from),
			month_to: String(calendar.to),
			month_days: days(calendar)
		};
		const month = datePeriod(window.salary_from, window.salary_to);
		const employed = intersect(
			month,
			datePeriod(
				contract.effective_range?.from ?? window.salary_from,
				contract.effective_range?.to ?? null
			)
		);
		const employedFrom = String(employed?.from ?? window.salary_from);
		const employedTo = String(employed?.to ?? window.salary_to);
		// After the exit the subject reads the terms last in force (a non-compete priced on the leaving wage).
		const exitedOn = contract.effective_range?.to;
		const term = termFor(
			contract,
			employed != null
				? employedTo
				: exitedOn != null && exitedOn < window.salary_from
					? exitedOn
					: window.salary_to
		);
		const monthDays = days(month);
		const paidDays = salaryRun && employed != null ? days(employed) : 0;
		const baseSalary = moneyValue(term?.base_salary);
		// Roster facts as recorded: the days, the hours they carry and the published holidays they fall on. Which of
		// them a jurisdiction pays, and at how many hours a day, is the work catalogue's CEL.
		const byDate = new Map(options.holidays.map((holiday) => [holiday.date, holiday]));
		// The planned shift of every day and what the roster recorded on it, in the entity's time zone.
		const rosterOn = new Map(options.roster.map((row) => [row.work_date, row]));
		const planOn = dayPlanner({
			contract,
			fallback: term,
			roster: rosterOn,
			definitions: options.definitions,
			patterns: options.patterns
		});
		const zone = zoneOf(options.entity, options.version);
		const employedOn = (date: string) => dayInRange(date, contract.effective_range ?? {});
		const workDays = datesFrom(window.attendance_from, window.attendance_to)
			.filter(employedOn)
			.map((date) =>
				workDay({
					date,
					planned: planOn(date),
					row: rosterOn.get(date),
					holiday: byDate.get(date),
					zone,
					suspension: suspensionOn(
						options.suspensions,
						contract.id,
						date,
						worksiteOn(rosterOn.get(date), termFor(contract, date))
					)
				})
			);
		// The days of the week the window opens in that fall before it (from `payroll.week_start`), as recorded —
		// already paid by the previous period — so a weekly limit is read on the whole week.
		const opens = new Date(`${window.attendance_from}T00:00:00Z`).getUTCDay();
		const lead = (opens - (options.version.payroll?.week_start ?? 0) + 7) % 7;
		const recorded = new Map(options.hoursRoster.map((row) => [row.work_date, row]));
		const planBefore = dayPlanner({
			contract,
			fallback: term,
			roster: recorded,
			definitions: options.definitions,
			patterns: options.patterns
		});
		const weekBefore = datesFrom(
			String(addDays(window.attendance_from, -lead)),
			String(addDays(window.attendance_from, -1))
		)
			.filter((date) => lead > 0 && employedOn(date))
			.map((date) => ({
				...workDay({
					date,
					planned: planBefore(date),
					row: recorded.get(date),
					holiday: options.hoursHolidays.get(date),
					zone
				}),
				in_period: false
			}));
		// The month's employed days from the 1st to the period's end, as recorded — earlier parts' days too, marked
		// `in_period: false` — so a monthly cap is read on a part of the month.
		const monthDaysToDate = datesFrom(String(calendar.from), window.salary_to)
			.filter(employedOn)
			.map((date) => ({
				...workDay({
					date,
					planned: planBefore(date),
					row: recorded.get(date),
					holiday: options.hoursHolidays.get(date),
					zone
				}),
				in_period: date >= window.attendance_from && date <= window.attendance_to
			}));
		const dayOn = new Map(workDays.map((day) => [String(day.date), day]));
		// A rostered day on a published holiday, worked or not: `worked` / `worked_hours` tell holiday work from a
		// holiday the person was off on.
		const holidays = options.roster.flatMap((row) => {
			const holiday = byDate.get(row.work_date);
			const day = dayOn.get(row.work_date);
			return holiday == null
				? []
				: [
						{
							date: holiday.date,
							name: holiday.name ?? '',
							kind: holiday.kind,
							given_to: holiday.given_to ?? '',
							replaces: holiday.replaces ?? '',
							day_type: day?.day_type ?? '',
							worked: day?.worked === true,
							worked_hours: num(day?.worked_hours)
						}
					];
		});
		const hours = hoursFrom({
			yearStartMonth: options.version.payroll?.tax_year_start_month ?? 1,
			...(options.version.payroll?.rolling_hours_months == null
				? {}
				: { rollingMonths: options.version.payroll.rolling_hours_months }),
			rows: options.hoursRoster,
			holidays: options.hoursHolidays,
			month: { from: String(calendar.from), to: String(calendar.to) },
			through: window.salary_to,
			planOn: dayPlanner({
				contract,
				fallback: term,
				roster: new Map(options.hoursRoster.map((row) => [row.work_date, row])),
				definitions: options.definitions,
				patterns: options.patterns
			}),
			zone
		});
		const previousFrom = String(addMonths(String(calendar.from), -1));
		const previousTo = String(addDays(String(calendar.from), -1));
		const periodExtras = {
			...periodParts,
			/** Working days of the period no-pay leave covers; set once the leave rows are priced. */
			unpaid_working_days: 0,
			paid_days: paidDays,
			pay_date: options.payDate,
			covered_days: employed == null ? 0 : days(employed),
			working_days: datesFrom(window.salary_from, window.salary_to).filter(
				(date) => planOn(date)?.day_type === 'WORK'
			).length,
			covered_working_days: datesFrom(window.salary_from, window.salary_to).filter(
				(date) => employedOn(date) && planOn(date)?.day_type === 'WORK'
			).length,
			// The whole calendar month's planned WORK days less published holidays, from the month's roster (else the
			// pattern): the same in every part, a day rate's divisor.
			month_working_days: datesFrom(String(calendar.from), String(calendar.to)).filter(
				(date) => planBefore(date)?.day_type === 'WORK' && !options.hoursHolidays.has(date)
			).length,
			// The month's published holidays on planned WORK days: a divisor that counts them adds this one.
			month_holiday_work_days: datesFrom(String(calendar.from), String(calendar.to)).filter(
				(date) => planBefore(date)?.day_type === 'WORK' && options.hoursHolidays.has(date)
			).length,
			// The same two for the calendar month before (the run's read reaches back a year): a divisor of last month's.
			previous_month_working_days: datesFrom(previousFrom, previousTo).filter(
				(date) => planBefore(date)?.day_type === 'WORK' && !options.hoursHolidays.has(date)
			).length,
			previous_month_holiday_work_days: datesFrom(previousFrom, previousTo).filter(
				(date) => planBefore(date)?.day_type === 'WORK' && options.hoursHolidays.has(date)
			).length
		};
		const work: DynObject = {
			overtime_hours: round2(options.roster.reduce((total, row) => total + paidOvertime(row), 0)),
			incentive_hours: options.roster.reduce((total, row) => total + num(row.incentive_hours), 0),
			dates: options.roster.map((row) => row.work_date),
			holidays,
			holiday_dates: options.holidays.map((holiday) => holiday.date),
			days: workDays,
			week_before: weekBefore,
			month_days: monthDaysToDate
		};
		// Each month's recorded attendance, scheduled days of leave by class and suspended days by kind, for
		// average-wage rules over `earned.months`/`history`.
		const worked = new Map<string, MonthTally>();
		const tallyOf = (month: string): MonthTally => {
			const held = worked.get(month) ?? emptyTally();
			worked.set(month, held);
			return held;
		};
		if (options.readsWorked) {
			for (const row of options.hoursRoster) {
				const day = workDay({
					date: row.work_date,
					planned: planBefore(row.work_date),
					row,
					holiday: undefined,
					zone
				});
				if (day.worked !== true) continue;
				const held = tallyOf(row.work_date.slice(0, 7));
				held.worked_days += 1;
				held.worked_hours = round2(held.worked_hours + num(day.worked_hours));
			}
			const since = String(addMonths(String(calendar.from), -LONG_HISTORY_MONTHS));
			for (const suspension of options.suspensions)
				for (const date of datesFrom(suspension.starts_on, suspension.ends_on))
					if (
						dayInRange(date, contract.effective_range ?? {}) &&
						suspensionOn(
							[suspension],
							contract.id,
							date,
							worksiteOn(undefined, termFor(contract, date))
						) != null
					) {
						const held = tallyOf(date.slice(0, 7));
						held.suspended_days += 1;
						held.suspended_days_by_kind[suspension.kind] =
							(held.suspended_days_by_kind[suspension.kind] ?? 0) + 1;
					}
			// A leave day is a scheduled (WORK) day of the plan an approved time-off movement covers.
			for (const row of options.timeOff) {
				if (row.employment_id !== contract.id || row.approval_id != null) continue;
				const code = options.leaveCodes.get(String(row.catalog_id));
				const from = String(row.from ?? row.occurred_on ?? '');
				if (code == null || from === '' || String(row.to ?? from) < since) continue;
				for (const date of datesFrom(from > since ? from : since, String(row.to ?? from)))
					if (employedOn(date) && planOn(date)?.day_type === 'WORK') {
						const held = tallyOf(date.slice(0, 7));
						held.leave_days[code] = (held.leave_days[code] ?? 0) + 1;
					}
			}
		}
		const earned = earnedFrom({
			history: options.history,
			period: monthKey,
			runKind: options.runKind,
			contract,
			yearStartMonth: options.version.payroll?.tax_year_start_month ?? 1,
			...(options.readsWorked ? { worked } : {})
		});
		const periodRoot: DynObject = {
			key: period,
			from: window.salary_from,
			to: window.salary_to,
			days: monthDays,
			...periodExtras
		};
		const context: DynObject = {
			...subjectContext({
				contract,
				employee,
				entity: options.entity,
				term,
				day: window.salary_to,
				headcount: options.headcount,
				version: options.version
			}),
			rules: options.rules,
			period: periodRoot,
			work,
			earned,
			hours,
			leave: {}
		};
		// A suspended day carries its kind's effects: counted as attended, still scheduled, and what it pays.
		function* suspend(
			list: JsonObject[],
			on: DynObject,
			planned: (date: string) => PlannedShift | null
		) {
			for (const [i, day] of list.entries()) {
				const found = day['suspended'];
				if (!isJsonObject(found)) continue;
				// The scheduled working days from the suspension's first through this one, across pay periods (planned by
				// the terms' pattern before this window): a "first N working days" floor reads it.
				const held: DynObject = {
					...found,
					working_days_elapsed: datesFrom(String(found['from']), String(day['date'])).filter(
						(date) => employedOn(date) && planned(date)?.day_type === 'WORK'
					).length
				};
				const kind = options.kinds.get(String(held['kind']));
				const dayContext: DynObject = { ...on, day, suspension: held };
				const effect = yield* suspendedDay(kind, dayContext);
				const pay =
					kind?.pay == null || kind.pay.trim() === ''
						? 0
						: money(
								yield* evaluateNumber(kind.pay, dayContext, `suspension_kind ${kind.code} pay`)
							);
				list[i] = { ...day, suspended: { ...held, ...effect, pay } };
			}
		}
		yield* suspend(workDays, context, planOn);
		const wages = new Map<string, Map<string, number>>();
		const base: PayslipPlan['base'][number][] = [];
		const proration: PayslipPlan['proration'][number][] = [];
		const adjustments: PayslipLine[] = [];
		const entryWarnings: string[] = [];
		const pins: PayslipPlan['pins'][number][] = [];
		let gross = 0;
		let netAdd = 0;
		let netSubtract = 0;
		/**
		 * One priced line: PAY lines move gross, NET lines only the net; every line moves the scheme parts it counts
		 * toward, so an EMPLOYER or DISPLAY line (a benefit in kind) reaches a tax base without being paid.
		 */
		const post = (row: CatalogRow, amount: number) => {
			const signed = row.direction === 'SUBTRACT' ? -amount : amount;
			for (const target of row.counts_toward ?? []) {
				const [scheme, part] = schemePart(target);
				const held = wages.get(scheme) ?? new Map<string, number>();
				held.set(part, (held.get(part) ?? 0) + signed);
				wages.set(scheme, held);
			}
			if (row.destination === 'PAY') gross += signed;
			else if (row.destination === 'NET') {
				if (signed >= 0) netAdd += signed;
				else netSubtract -= signed;
			}
			return signed;
		};

		/**
		 * A salary slip's exit corrections, as adjustments; how many it made. A departure (an exit ground with its last
		 * day) raises each `raise_on_exit` ad hoc class whose eligibility holds, priced by its bands on an empty entry of
		 * the exit day, once per exit as it stands (`exit:<code>:<day>/<ground>`), on the first salary slip reaching it —
		 * unless HR entered the class. The exit pay a paid slip carried for an exit since moved or undone is taken back
		 * at what it paid. A paid period's prorated lines are repriced over the days it now covers (an exit moved or
		 * undone after the final slip): fully covered again, its contract amount; uncovered, nothing; else its paid
		 * amount moved by the record's divisor per day. Nothing is corrected twice: each correction names its source.
		 */
		function* exitCorrections(salaried: boolean) {
			let made = 0;
			const flip = (row: CatalogRow, amount: number): CatalogRow =>
				amount >= 0
					? row
					: { ...row, direction: row.direction === 'SUBTRACT' ? 'ADD' : 'SUBTRACT' };
			const add = (
				row: CatalogRow,
				amount: number,
				line: Pick<PayslipLine, 'family' | 'source_id' | 'component_code' | 'label'>,
				/** The paid period ends the day before this window: the first run that can see the change. */
				fresh: boolean
			) => {
				// a leaver's slip pays nothing to recover from: the overpayment is flagged on the first run after it, not
				// charged as negative pay
				if (amount < 0 && !salaried) {
					if (fresh)
						options.notes.push(
							`${who}: ${line.label ?? line.component_code} overpaid ${money(-amount)} after the exit moved; recover it outside payroll.`
						);
					return;
				}
				const posted = post(flip(row, amount), Math.abs(amount));
				made++;
				adjustments.push({
					...line,
					bucket: posted >= 0 && row.destination === 'PAY' ? 'EARNING' : 'DEDUCTION',
					destination: row.destination === 'PAY' ? 'PAY' : 'NET',
					amount: posted
				});
			};
			const lines = options.history.flatMap((slip) =>
				(slip.adjustments ?? []).map((line) => ({ slip, line }))
			);
			const sourced = new Set(lines.map(({ line }) => String(line.source_id ?? '')));
			const exitDay = contract.effective_range?.to ?? null;
			const departed =
				contract.exit_ground != null && contract.exit_ground !== '' && exitDay != null;
			const key = departed ? `${exitDay}/${contract.exit_ground}` : '';
			// what paid slips paid for an exit no longer standing, taken back once
			for (const { slip, line } of lines) {
				const source = String(line.source_id ?? '');
				if (slip.status !== 'PAID' || line.family !== EXIT_FAMILY || source.endsWith(':reversal'))
					continue;
				if (source.endsWith(`:${key}`) && key !== '') continue;
				if (sourced.has(`${source}:reversal`)) continue;
				const code = String(line.component_code ?? '');
				const row = options.exitClasses.find((held) => held.code === code) ?? {
					id: code,
					code,
					destination: line.destination === 'PAY' ? 'PAY' : 'NET',
					counts_toward: []
				};
				const paidIn = options.runWindows.get(String(slip.payroll_run_id ?? ''));
				add(
					row,
					-moneyValue(line.amount),
					{
						family: EXIT_FAMILY,
						source_id: `${source}:reversal`,
						component_code: code,
						label: `${line.label ?? code} (exit withdrawn)`
					},
					paidIn != null && String(addDays(paidIn.to, 1)) === window.salary_from
				);
			}
			// the exit pay of the exit as it stands, once
			if (
				departed &&
				exitDay <= window.salary_to &&
				exitDay >= String(addMonths(window.salary_from, -1))
			) {
				const entered = new Set(
					options.entries.flatMap((family) => family.siblings.map((row) => row.code))
				);
				for (const row of options.exitClasses) {
					const source = `exit:${row.code}:${key}`;
					if (sourced.has(source) || entered.has(row.code)) continue;
					const entryCtx: DynObject = {
						...context,
						entry: entryContext({ amount: 0, facts: {} }, exitDay),
						earlier: earlierContext([], { code: row.code, occurred_on: exitDay })
					};
					const where = `adhoc_catalog ${row.code}`;
					if (!(yield* evaluateBoolean(row.eligibility, entryCtx, where))) continue;
					if (!(yield* evaluateBoolean(row.qualifies_when, entryCtx, where))) continue;
					let amount = 0;
					for (const band of row.bands ?? []) {
						if (!(yield* evaluateBoolean(band.when, entryCtx, where))) continue;
						amount = yield* evaluateNumber(band.amount, entryCtx, where);
						break;
					}
					amount = money(amount);
					if (amount === 0) continue;
					add(
						row,
						amount,
						{
							family: EXIT_FAMILY,
							source_id: source,
							component_code: row.code,
							label: row.name ?? row.code
						},
						true
					);
				}
			}
			// paid periods repriced over the days they now cover. A switched month settles month to date: its own earlier
			// slips are settled by this run's lines, and a slip a later month-to-date slip of its month superseded is
			// repriced through that one, over the month from the 1st.
			const settledBy = (slip: PayslipHistoryRow) => {
				const from = String(slip.salary_from ?? '').slice(0, 10);
				return options.history.some(
					(other) =>
						other !== slip &&
						String(other.salary_from ?? '').slice(0, 7) === from.slice(0, 7) &&
						String(other.salary_from ?? '').slice(0, 10) > from &&
						(other.proration ?? []).some((held) => held.window_from != null)
				);
			};
			for (const slip of options.history) {
				const run = options.runWindows.get(String(slip.payroll_run_id ?? ''));
				if (slip.status !== 'PAID' || run == null || run.to >= window.salary_from) continue;
				if (options.switched && run.from.slice(0, 7) === window.salary_from.slice(0, 7)) continue;
				if (settledBy(slip)) continue;
				for (const held of slip.proration ?? []) {
					const opens = held.window_from ?? run.from;
					const covered = intersect(
						datePeriod(opens, run.to),
						datePeriod(
							contract.effective_range?.from ?? opens,
							contract.effective_range?.to ?? null
						)
					);
					const now = covered == null ? 0 : days(covered);
					const code = String(held.component_code ?? '');
					const paid = moneyValue(held.prorated_amount);
					const full = moneyValue(held.contract_amount);
					const was = num(held.days);
					const target =
						now === was
							? paid
							: now === 0
								? 0
								: now === days(datePeriod(opens, run.to))
									? full
									: paid + (full * (now - was)) / Math.max(1, num(held.denominator, 1));
					const source = `${String(slip.id)}:${code}`;
					const done = lines
						.filter(({ line }) => line.family === CORRECTION_FAMILY && line.source_id === source)
						.reduce((total, { line }) => total + moneyValue(line.amount), 0);
					const owed = money(target - paid - done);
					if (owed === 0) continue;
					const row = options.workRows.find(
						(candidate) => (candidate.component_code ?? candidate.code) === code
					) ?? { id: code, code, destination: 'PAY', counts_toward: [] };
					add(
						row,
						owed,
						{
							family: CORRECTION_FAMILY,
							source_id: source,
							component_code: code,
							label: `${row.name ?? code} ${opens}–${run.to} (exit moved)`
						},
						String(addDays(run.to, 1)) === window.salary_from
					);
				}
			}
			return made;
		}

		// A salary run pays the contract for its employed days only; after the exit it pays only the period's entries
		// (a class payable after exit: non-compete pay, separation instalments).
		const salaried = salaryRun && term != null && paidDays > 0 && contract.engagement !== 'PAYEE';
		// Without salary a run pays a payee's entries, and past the exit the classes payable after it.
		const unsalaried = (row: EntryRow) =>
			options.classes.get(String(row.catalog_id))?.payable_after_exit === true ||
			(contract.engagement === 'PAYEE' && employedOn(String(row.occurred_on ?? '')));
		const corrections = salaryRun ? yield* exitCorrections(salaried) : 0;
		if (
			salaryRun &&
			!salaried &&
			corrections === 0 &&
			!options.entries.some((family) =>
				family.rows.some((row) => {
					const day = String(row.occurred_on ?? '');
					return (
						family.family !== 'LEAVE' &&
						unsalaried(row) &&
						day >= window.salary_from &&
						day <= window.salary_to
					);
				})
			)
		)
			return null;
		/**
		 * The leave rows reaching into `from`–`to`, projected generically: the class's own flags beside the row's stored
		 * values, each row's share of the window, the working days no-pay leave covers and the rows the window settles
		 * (ending in it). Which days become no-pay or cash is the work catalogue's record to decide, never this engine's.
		 */
		function* projectLeave(
			rows: readonly EntryRow[],
			from: string,
			to: string,
			on: DynObject,
			planned: (date: string) => PlannedShift | null
		) {
			const leaveRows: Json[] = [];
			const unpaidDays = new Set<string>();
			const settled: string[] = [];
			const isWorkDay = (date: string) => employedOn(date) && planned(date)?.day_type === 'WORK';
			for (const row of rows) {
				const day = String(row.from ?? row.occurred_on ?? '');
				const last = String(row.to ?? day);
				// A row reaching into this period prices its share of it; it is settled (pinned) by the period holding its end.
				if (last < from || day > to) continue;
				const spanned = datesFrom(day, last).filter(employedOn);
				const inside = spanned.filter((date) => date >= from && date <= to);
				const working = spanned.filter(isWorkDay).length;
				const workingInside = inside.filter(isWorkDay).length;
				const total = num(row.days);
				const held = options.classes.get(String(row.catalog_id));
				// The share by working days covered (by calendar days when the row covers none), or by calendar days
				// when the class's `share_by` says.
				const byWorking = held?.share_by !== 'CALENDAR_DAYS' && working > 0;
				const share =
					inside.length === spanned.length
						? total
						: Number(
								(byWorking
									? (total * workingInside) / working
									: spanned.length === 0
										? 0
										: (total * inside.length) / spanned.length
								).toFixed(4)
							);
				const portion = day < from ? from : day;
				const facts = isDynObject(row.facts) ? row.facts : {};
				const event = eventIdOf(row.facts);
				// Days taken before this row's share here, for the same absence: earlier movements of its event (or,
				// without one, its chain), and the row's own share of earlier periods. By class code, and this class's.
				const chain = options.chainFrom.get(row.id) ?? day;
				const before = spanned.filter((date) => date < from);
				const ownBefore =
					before.length === 0
						? 0
						: byWorking
							? (total * before.filter(isWorkDay).length) / working
							: spanned.length === 0
								? 0
								: (total * before.length) / spanned.length;
				const takenByClass: { [code: string]: number } = {};
				for (const other of options.timeOff) {
					if (other.employment_id !== contract.id || other.approval_id != null) continue;
					if (other.id === row.id) continue;
					const start = String(other.from ?? other.occurred_on ?? '');
					if (start === '' || start >= day) continue;
					const same =
						event == null
							? options.chainFrom.get(String(other.id)) === chain
							: eventIdOf(other.facts) === event;
					if (!same) continue;
					const code = options.leaveCodes.get(String(other.catalog_id)) ?? '';
					takenByClass[code] = (takenByClass[code] ?? 0) + num(other.days);
				}
				const own = held?.code ?? '';
				takenByClass[own] = (takenByClass[own] ?? 0) + ownBefore;
				for (const code of Object.keys(takenByClass))
					takenByClass[code] = Number((takenByClass[code] ?? 0).toFixed(4));
				const projected: DynObject = {
					code: held?.code ?? '',
					activity: row.activity ?? 'TIME_OFF',
					days: share,
					total_days: total,
					period_calendar_days: inside.length,
					period_working_days: workingInside,
					from: day,
					to: last,
					is_npl: held?.is_npl === true,
					// The model's default, as balances read it: encashable unless the class says not.
					can_encash: held?.can_encash !== false,
					event_id: event ?? '',
					chain_from: chain,
					taken_before: takenByClass[own] ?? 0,
					taken_before_by_class: takenByClass,
					month_index:
						completedMonths(
							(event == null ? undefined : options.eventStart.get(`${contract.id}:${event}`)) ??
								options.chainFrom.get(row.id) ??
								day,
							portion
						) + 1,
					facts
				};
				const fraction = held?.pay_fraction;
				const payFraction =
					fraction == null || fraction.trim() === ''
						? 1
						: yield* evaluateNumber(
								fraction,
								{ ...on, entry: entryContext(row, day), leave: projected },
								`leave_catalog ${held?.code ?? ''} pay_fraction`
							);
				leaveRows.push({ ...projected, pay_fraction: payFraction });
				if (held?.is_npl === true || payFraction === 0)
					for (const date of inside) if (isWorkDay(date)) unpaidDays.add(date);
				if (last <= to) settled.push(row.id);
			}
			return { rows: leaveRows, unpaid: unpaidDays.size, settled };
		}
		if (salaried || !salaryRun) {
			// The window's leave rows are projected once, generically: the class's own flags beside the row's stored
			// values. Which days become no-pay or cash is the work catalogue's record to decide, never this engine's. An
			// off-cycle slip reads the same rows (a bonus exempt during childcare leave) and settles none of them.
			const leaveFamily = options.entries.find((family) => family.family === 'LEAVE');
			const projected = yield* projectLeave(
				leaveFamily?.rows ?? [],
				window.salary_from,
				window.salary_to,
				context,
				planOn
			);
			context.leave = { rows: projected.rows };
			if (salaried)
				for (const id of projected.settled) pins.push({ collection: 'leave_catalog_entry', id });
			const unpaid = salaried ? projected.unpaid : 0;
			periodExtras.unpaid_working_days = unpaid;
			periodRoot.unpaid_working_days = unpaid;
		}
		/**
		 * A month paid at more than one frequency (`pay_frequency_changes`) settles month to date: every contract line is
		 * priced as a monthly run over the 1st to this period's end (its days, attendance, leave and roster as recorded,
		 * earlier parts included) and pays that less what the month's earlier salary slips paid for it. So a part at one
		 * frequency and the rest at another pay exactly one month, whatever the records divide by.
		 */
		function* monthToDate() {
			const from = String(calendar.from);
			const to = window.salary_to;
			const cutoff = CYCLES.includes(options.entity.pay_frequency ?? '')
				? 1
				: (options.entity.pay_cutoff_day ?? 1);
			const attendFrom = payrollWindow(
				{ from, to: String(calendar.to), part: 1, parts: 1 },
				cutoff
			).attendance_from;
			const attendTo = window.attendance_to;
			const span = intersect(
				datePeriod(from, to),
				datePeriod(contract.effective_range?.from ?? from, contract.effective_range?.to ?? null)
			);
			const covered = span == null ? 0 : days(span);
			const isWork = (date: string) => planBefore(date)?.day_type === 'WORK';
			const rows = options.hoursRoster.filter(
				(row) => row.work_date >= attendFrom && row.work_date <= attendTo
			);
			const list = datesFrom(attendFrom, attendTo)
				.filter(employedOn)
				.map((date) =>
					workDay({
						date,
						planned: planBefore(date),
						row: recorded.get(date),
						holiday: options.hoursHolidays.get(date),
						zone,
						suspension: suspensionOn(
							options.suspensions,
							contract.id,
							date,
							worksiteOn(recorded.get(date), termFor(contract, date))
						)
					})
				);
			const on = new Map(list.map((day) => [String(day.date), day]));
			const periodMtd: DynObject = {
				...periodRoot,
				from,
				to,
				days: days(calendar),
				part: 1,
				parts: 1,
				paid_days: covered,
				covered_days: covered,
				working_days: datesFrom(from, String(calendar.to)).filter(isWork).length,
				covered_working_days: datesFrom(from, to).filter((date) => employedOn(date) && isWork(date))
					.length
			};
			const settling: DynObject = {
				...context,
				period: periodMtd,
				work: {
					...work,
					overtime_hours: round2(rows.reduce((total, row) => total + paidOvertime(row), 0)),
					incentive_hours: rows.reduce((total, row) => total + num(row.incentive_hours), 0),
					dates: rows.map((row) => row.work_date),
					holidays: rows.flatMap((row) => {
						const holiday = options.hoursHolidays.get(row.work_date);
						const day = on.get(row.work_date);
						return holiday == null
							? []
							: [
									{
										date: holiday.date,
										name: holiday.name ?? '',
										kind: holiday.kind,
										given_to: holiday.given_to ?? '',
										replaces: holiday.replaces ?? '',
										day_type: day?.day_type ?? '',
										worked: day?.worked === true,
										worked_hours: num(day?.worked_hours)
									}
								];
					}),
					holiday_dates: [...options.hoursHolidays.keys()].filter(
						(date) => date >= attendFrom && date <= attendTo
					),
					days: list
				}
			};
			yield* suspend(list, settling, planBefore);
			const leave = yield* projectLeave(options.monthLeave, from, to, settling, planBefore);
			settling['leave'] = { rows: leave.rows };
			periodMtd['unpaid_working_days'] = leave.unpaid;
			// what the month's earlier salary slips paid, by line code (signed, as stored)
			const paid = new Map<string, number>();
			for (const slip of options.history) {
				const day = String(slip.salary_from ?? '').slice(0, 10);
				if (day < from || day >= window.salary_from) continue;
				if (!isSalaryRun(options.runKind.get(String(slip.payroll_run_id ?? '')))) continue;
				for (const line of slip.base ?? []) {
					const code = String(line.component_code ?? '');
					paid.set(code, money((paid.get(code) ?? 0) + moneyValue(line.amount)));
				}
			}
			return {
				context: settling,
				paid,
				span: {
					from: String(span?.from ?? from),
					to: String(span?.to ?? to),
					days: covered
				}
			};
		}

		if (salaried && term != null) {
			if (baseSalary <= 0 && options.version.payroll?.base_salary_required !== false)
				return yield* Effect.fail(
					new Refusal({
						message: `${who}: the contract in force for ${period} carries no base salary.`
					})
				);
			const settling = options.switched ? yield* monthToDate() : undefined;
			const priceOn = settling?.context ?? context;
			const priced = new Set<string>();
			// A switched month's line pays the month to date less what the month's earlier slips paid for it.
			const owed = (row: CatalogRow, code: string, amount: number) => {
				priced.add(code);
				const before = settling?.paid.get(code) ?? 0;
				return money(amount - (row.direction === 'SUBTRACT' ? -before : before));
			};
			for (const row of options.workRows) {
				const where = `work_catalog ${row.code}`;
				const code = row.component_code ?? row.code;
				if (!(yield* evaluateBoolean(row.eligibility, priceOn, where))) continue;
				const quantity = yield* evaluateNumber(row.quantity ?? '1.0', priceOn, where);
				const rate = yield* evaluateNumber(row.rate ?? '0.0', priceOn, where);
				const toDate = money(quantity * rate);
				const amount = owed(row, code, toDate);
				if (amount === 0) continue;
				const signed = post(row, amount);
				base.push({
					component_code: code,
					label: row.name ?? row.code,
					amount: signed,
					quantity: Number(quantity.toFixed(6)),
					rate: round2(rate)
				});
				if (row.prorated === true)
					proration.push({
						component_code: code,
						...(settling == null
							? { from: employedFrom, to: employedTo, days: paidDays }
							: {
									from: settling.span.from,
									to: settling.span.to,
									days: settling.span.days,
									window_from: String(calendar.from)
								}),
						// The divisor the record states (`denominator`), else the period's calendar days.
						denominator:
							row.denominator == null || row.denominator.trim() === ''
								? settling == null
									? monthDays
									: days(calendar)
								: yield* evaluateNumber(row.denominator, priceOn, `${where} denominator`),
						contract_amount: money(rate),
						prorated_amount: settling == null ? signed : toDate
					});
			}
			if (
				options.roster.some(
					(row) => num(row.approved_overtime_hours) + num(row.incentive_hours) > 0
				) ||
				holidays.length > 0
			)
				for (const row of options.roster) pins.push({ collection: 'roster_entry', id: row.id });
			// Contract allowances price through the governing version's allowance class of the same code.
			const allowanceById = new Map(options.allowanceRows.map((row) => [row.id, row]));
			const allowanceByCode = new Map(options.allowanceRows.map((row) => [row.code, row]));
			const capturedAllowances = (term.allowances ?? []).filter(
				(line) => moneyValue(line.amount) !== 0
			);
			for (const line of capturedAllowances) {
				const code =
					line.code ??
					(line.catalogue_id == null
						? undefined
						: (allowanceById.get(line.catalogue_id)?.code ??
							options.capturedAllowanceCodes.get(line.catalogue_id)));
				const row = code == null ? undefined : allowanceByCode.get(code);
				if (row == null)
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: a contract allowance names no allowance class of ${options.version.code}.`
						})
					);
				const where = `allowance_catalog ${row.code}`;
				const allowanceContext: DynObject = {
					...priceOn,
					allowance: { code: row.code, amount: moneyValue(line.amount) }
				};
				if (!(yield* evaluateBoolean(row.eligibility, allowanceContext, where))) continue;
				if (row.amount == null)
					return yield* Effect.fail(
						new Refusal({ message: `${where}: the class states no amount expression.` })
					);
				const amount = owed(
					row,
					row.code,
					money(yield* evaluateNumber(row.amount, allowanceContext, where))
				);
				if (amount === 0) continue;
				base.push({
					component_code: row.code,
					label: row.name ?? row.code,
					amount: post(row, amount)
				});
			}
			// a line the month's earlier slips paid that is no longer owed is taken back
			for (const [code, before] of settling?.paid ?? []) {
				if (priced.has(code) || before === 0) continue;
				const row = [...options.workRows, ...options.allowanceRows].find(
					(held) => (held.component_code ?? held.code) === code
				) ?? { id: code, code, destination: 'PAY', counts_toward: [] };
				base.push({
					component_code: code,
					label: row.name ?? code,
					amount: post(row, row.direction === 'SUBTRACT' ? before : -before)
				});
			}
		}

		let settlesAfterExit = false;
		for (const family of options.entries) {
			if (family.family === 'LEAVE') continue;
			for (const row of family.rows) {
				const chosen = options.selected.has(row.id);
				if (!salaryRun && !chosen) continue;
				if (salaryRun && options.selected.size > 0 && !chosen) continue;
				const occurred = String(row.occurred_on ?? '');
				if (salaryRun && (occurred < window.salary_from || occurred > window.salary_to)) continue;
				// Without salary a salary run pays only a payee's entries and the classes payable after exit.
				if (salaryRun && !salaried && !unsalaried(row)) continue;
				const priced = options.classes.get(String(row.catalog_id));
				if (priced == null)
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: entry ${row.id} names a class ${options.version.code} does not carry.`
						})
					);
				const entryCtx: DynObject = {
					...context,
					entry: entryContext(row, occurred),
					earlier: earlierContext(family.siblings, {
						id: row.id,
						code: priced.code,
						occurred_on: occurred
					})
				};
				const where = `${family.collection.replace('_entry', '')} ${priced.code}`;
				if (!(yield* evaluateBoolean(priced.eligibility, entryCtx, where)))
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: ${priced.name ?? priced.code} is not available to this employment.`
						})
					);
				if (!(yield* evaluateBoolean(priced.qualifies_when, entryCtx, where)))
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: entry ${row.reference ?? row.id} does not qualify as ${priced.name ?? priced.code}.`
						})
					);
				let priceAmount = moneyValue(row.amount);
				const label = `${priced.name ?? priced.code} ${row.reference ?? occurred}`;
				for (const band of priced.bands ?? []) {
					if (!(yield* evaluateBoolean(band.when, entryCtx, where))) continue;
					priceAmount = yield* evaluateNumber(band.amount, entryCtx, where);
					const limit = band.limit;
					if (limit?.amount != null && row.activity !== 'REVERSAL') {
						// The limit meters its window: this claim alone, or less what the class already took in the
						// settlement period or the calendar year. BLOCK pays up to it, ALLOW pays all; either flags the excess.
						const before = (entryCtx['earlier'] as { rows: readonly JsonObject[] }).rows;
						const taken =
							limit.window === 'PERIOD'
								? earlierSum(before, window.salary_from, window.salary_to)
								: limit.window === 'CALENDAR_YEAR'
									? earlierSum(
											before,
											`${occurred.slice(0, 4)}-01-01`,
											`${occurred.slice(0, 4)}-12-31`
										)
									: 0;
						const left = Math.max(
							0,
							(yield* evaluateNumber(limit.amount, entryCtx, where)) - taken
						);
						if (priceAmount > left) {
							const excess = money(priceAmount - left);
							entryWarnings.push(
								limit.on_exceed === 'ALLOW'
									? `${who}: ${label} exceeds its limit by ${excess}; paid in full.`
									: `${who}: ${label} exceeds its limit by ${excess}; paid up to it.`
							);
							if (limit.on_exceed !== 'ALLOW') priceAmount = left;
						}
					}
					break;
				}
				const reversal = row.activity === 'REVERSAL';
				const signedAmount = money(reversal ? -priceAmount : priceAmount);
				// A class payable after exit is settled even when it pays nothing (a waived instalment): the slip keeps it
				// for the year's statutory return.
				if (priced.payable_after_exit === true) {
					pins.push({ collection: family.collection, id: row.id });
					settlesAfterExit = true;
				}
				// an entry that prices to nothing pays nothing: flagged, never silent
				if (signedAmount === 0) {
					if (priced.payable_after_exit !== true)
						entryWarnings.push(`${who}: ${label} prices to nothing; it stays unpaid.`);
					continue;
				}
				const posted = post(
					reversal
						? { ...priced, direction: priced.direction === 'SUBTRACT' ? 'ADD' : 'SUBTRACT' }
						: priced,
					Math.abs(signedAmount)
				);
				if (priced.payable_after_exit !== true)
					pins.push({ collection: family.collection, id: row.id });
				// An EMPLOYER or DISPLAY entry is paid by no one on this slip: it only moves its scheme parts.
				if (priced.destination === 'EMPLOYER' || priced.destination === 'DISPLAY') continue;
				adjustments.push({
					family: family.family,
					source_id: row.id,
					component_code: priced.code,
					bucket: posted >= 0 && priced.destination === 'PAY' ? 'EARNING' : 'DEDUCTION',
					destination: priced.destination === 'PAY' ? 'PAY' : 'NET',
					amount: posted,
					label: row.label ?? priced.name ?? priced.code
				});
			}
		}

		gross = money(gross);
		if (
			gross === 0 &&
			adjustments.length === 0 &&
			!settlesAfterExit &&
			!(salaryRun && options.assessesWithoutWage)
		)
			return null;
		const { lines: statutory, warnings } = yield* assessStatutory({
			who,
			subject: subjectContext({
				contract,
				employee,
				entity: options.entity,
				term,
				day: window.salary_from,
				headcount: options.headcount,
				version: options.version
			}),
			subjectOn: (asOf) =>
				subjectContext({
					contract,
					employee,
					entity: options.entity,
					term,
					day: asOf === 'pay_date' ? options.payDate : window.salary_to,
					headcount: options.headcount,
					version: options.version
				}),
			rules: options.rules,
			statutoryRows: options.statutoryRows,
			schemeCodes: options.schemeCodes,
			standing: statutoryFactsFromFacts(employee?.facts),
			period,
			window: { from: window.salary_from, to: window.salary_to },
			periodExtras,
			roots: { work, earned, hours, leave: context.leave ?? {} },
			lines: [...base, ...adjustments].map((line) => ({
				code: line.component_code,
				amount: line.amount
			})),
			previousMonth: String(addMonths(`${monthKey}-01`, -1)).slice(0, 7),
			available: money(gross - netSubtract + netAdd),
			money: options.money,
			yearStartMonth: options.version.payroll?.tax_year_start_month ?? 1,
			wages,
			parts: options.parts,
			history: options.history,
			runKind: options.runKind
		});
		warnings.unshift(...entryWarnings);
		const employeeStatutory = money(
			statutory.reduce((total, row) => total + row.employee_amount, 0)
		);
		const employerStatutory = money(
			statutory.reduce((total, row) => total + row.employer_amount, 0)
		);
		// A slip kept only for a scheme assessed without wage is dropped when that scheme charged nothing either.
		if (
			gross === 0 &&
			adjustments.length === 0 &&
			!settlesAfterExit &&
			employeeStatutory === 0 &&
			employerStatutory === 0
		)
			return null;
		// A `carry_uncovered` scheme's employee share net cannot cover is advanced on this slip (a NET line); an advance
		// still outstanding from earlier slips is recovered from what this one's net leaves, as far as it goes.
		let advanced = 0;
		const carry = (code: string, amount: number) => {
			adjustments.push({
				family: CARRY_FAMILY,
				source_id: code,
				component_code: `${code}_CARRIED`,
				bucket: amount >= 0 ? 'EARNING' : 'DEDUCTION',
				destination: 'NET',
				amount,
				label: `${code} carried`
			});
			if (amount >= 0) {
				netAdd += amount;
				advanced += amount;
			} else netSubtract -= amount;
		};
		const carries = new Set(
			options.statutoryRows
				.filter((row) => row.configuration?.carry_uncovered === true)
				.map((row) => row.code)
		);
		for (const line of statutory) {
			const short = money(employeeStatutory + netSubtract - gross - netAdd);
			if (short <= 0) break;
			if (carries.has(line.scheme_code) && line.employee_amount > 0)
				carry(line.scheme_code, money(Math.min(short, line.employee_amount)));
		}
		const outstanding = new Map<string, number>();
		for (const held of options.history)
			for (const line of held.adjustments ?? [])
				if (line.family === CARRY_FAMILY && line.component_code != null)
					outstanding.set(
						line.component_code,
						money((outstanding.get(line.component_code) ?? 0) + moneyValue(line.amount))
					);
		for (const [code, owed] of [...outstanding].toSorted()) {
			const left = money(gross + netAdd - employeeStatutory - netSubtract);
			if (owed > 0 && left > 0) carry(code.replace(/_CARRIED$/, ''), -money(Math.min(owed, left)));
		}
		const total_deductions = money(employeeStatutory + netSubtract);
		const net = money(gross - total_deductions + netAdd);
		if (net < 0 && options.version.payroll?.negative_net !== 'allow')
			return yield* Effect.fail(
				new Refusal({ message: `${who}: net pay would be negative (${net}).` })
			);
		// The payslip validations read the slip as built: `payslip` (its totals and lines by code) and `statutory`.
		const lines: { [code: string]: number } = {};
		for (const line of [...base, ...adjustments])
			lines[line.component_code] = money((lines[line.component_code] ?? 0) + line.amount);
		let hold: string | null = null;
		for (const check of yield* tripped(options.validations, {
			...context,
			payslip: {
				gross,
				net,
				total_deductions,
				statutory_employee: employeeStatutory,
				statutory_employer: employerStatutory,
				net_additions: money(netAdd),
				net_deductions: money(netSubtract),
				lines
			},
			statutory: Object.fromEntries(
				statutory.map((line) => [
					line.scheme_code,
					{ employee: line.employee_amount, employer: line.employer_amount }
				])
			)
		})) {
			if (check.kind === 'refuse')
				return yield* Effect.fail(new Refusal({ message: `${who}: ${check.message}` }));
			warnings.push(`${who}: ${check.message}`);
			if (check.kind === 'hold') hold ??= check.message;
		}
		return {
			employment_id: contract.id,
			salary_from: salaryRun ? employedFrom : window.salary_from,
			salary_to: salaryRun ? employedTo : window.salary_to,
			currency: options.currency,
			base,
			adjustments,
			statutory,
			gross,
			total_deductions,
			net,
			// An advanced share is the employee's, recovered later: not a cost of employment.
			employer_cost: money(gross + netAdd - advanced + employerStatutory),
			proration,
			service_basis: salaried
				? [
						{
							from: employedFrom,
							to: employedTo,
							days: paidDays,
							denominator: proration[0]?.denominator ?? monthDays
						}
					]
				: [],
			pins,
			warnings,
			hold
		};
	});

/** The adjustment family of a statutory share advanced or recovered (`carry_uncovered`). */
const CARRY_FAMILY = 'STATUTORY_CARRY';
/** The adjustment families of an exit's own pay (`raise_on_exit`) and of a paid period repriced after its exit moved. */
const EXIT_FAMILY = 'EXIT';
const CORRECTION_FAMILY = 'CORRECTION';

const ContributionAmounts = Schema.Struct({ employee: Schema.Number, employer: Schema.Number });

/** Per-part sums over stored statutory lines. */
const partSums = (
	lines: readonly Partial<PayslipStatutoryLine>[],
	parts: ReadonlySet<string>
): { [part: string]: number } => {
	const out: { [part: string]: number } = Object.fromEntries([...parts].map((part) => [part, 0]));
	for (const line of lines)
		for (const [part, amount] of Object.entries(line.parts ?? {}))
			out[part] = (out[part] ?? 0) + num(amount);
	return out;
};

/**
 * Month-to-date statutory settlement: the month's total liability is computed over every wage paid in the month
 * (earlier slips plus this one) and the earlier slips' charges are subtracted. Order-independent, so an off-cycle
 * run paid before its month's regular run adds up to the same month total. Each scheme's record says how a month's
 * wage parts are assessed (`assessable`), how it reads the person (`person`) and what it charges (`rules`); the
 * context carries this slip's wage parts (`wage`), the month to date (`month`), the earlier months of the year
 * (`year`) and the period's facts.
 */
const assessStatutory = (input: {
	readonly who: string;
	readonly subject: DynObject;
	/** The subject read on another day, for a scheme whose `configuration.as_of` names one. */
	readonly subjectOn: (asOf: string) => DynObject;
	readonly rules: DynObject;
	readonly statutoryRows: readonly StatutoryRow[];
	readonly schemeCodes: ReadonlyMap<string, string>;
	readonly standing: ReturnType<typeof statutoryFactsFromFacts>;
	/** The run's period key and its settlement window (a calendar month, or a part of one). */
	readonly period: string;
	readonly window: { readonly from: string; readonly to: string };
	/** The slip's own days: those inside the employment and the planned working days. */
	readonly periodExtras: DynObject;
	/** The slip's `work`, `earned` and `hours` roots, shared with the payslip context. */
	readonly roots: DynObject;
	readonly wages: ReadonlyMap<string, ReadonlyMap<string, number>>;
	readonly parts: SchemeParts;
	readonly history: readonly PayslipHistoryRow[];
	readonly runKind: ReadonlyMap<string, string>;
	/** This slip's priced lines, each `{ code, amount }`: a per-payment threshold reads them one by one. */
	readonly lines: readonly { readonly code: string; readonly amount: number }[];
	/** The calendar month before this one, `YYYY-MM`. */
	readonly previousMonth: string;
	/** The slip's net before statutory: gross plus net additions less net deductions. */
	readonly available: number;
	/** Money to the payroll currency's minor units. */
	readonly money: (value: number) => number;
	/** The month the year (`year`, `charged.year`, `charged.previous_year`) starts in. */
	readonly yearStartMonth: number;
}): Effect.Effect<{ lines: PayslipStatutoryLine[]; warnings: string[] }, Refusal> =>
	Effect.gen(function* () {
		const { money } = input;
		const yearStart = taxYearStart(input.window.from.slice(0, 7), input.yearStartMonth);
		const warnings: string[] = [];
		const { subject, period } = input;
		const month = input.window.from.slice(0, 7);
		const inYear = input.history.filter(
			(slip) => slipPeriod(slip) >= yearStart && slipPeriod(slip) <= month
		);
		const monthPrior = inYear.filter((slip) => slipPeriod(slip) === month);
		const before = inYear.filter((slip) => slipPeriod(slip) < month);
		const lines = (slips: readonly PayslipHistoryRow[], code: string) =>
			slips.flatMap((slip) => (slip.statutory ?? []).filter((line) => line.scheme_code === code));
		const periodFacts = {
			key: period,
			from: input.window.from,
			to: input.window.to,
			days: days(datePeriod(input.window.from, input.window.to)),
			month: Number(month.slice(5, 7)),
			...input.periodExtras,
			salary_paid: monthPrior.some((slip) =>
				isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
			)
		};
		const assessed: PayslipStatutoryLine[] = [];
		const amounts = (
			list: readonly { employee_amount?: unknown; employer_amount?: unknown }[]
		) => ({
			employee: money(list.reduce((sum, line) => sum + num(line.employee_amount), 0)),
			employer: money(list.reduce((sum, line) => sum + num(line.employer_amount), 0))
		});
		const codes = input.statutoryRows.map((row) => row.code);
		// A scheme that reads another's month charge (`charged.month.CODE`) is assessed after it; otherwise by code.
		const reads = new Map(
			input.statutoryRows.map((row) => [
				row.code,
				new Set(
					[...JSON.stringify(row.configuration ?? {}).matchAll(/charged\.month\.([A-Za-z0-9_]+)/g)]
						.map((match) => match[1]!)
						.filter((code) => code !== row.code && codes.includes(code))
				)
			])
		);
		const ordered: StatutoryRow[] = [];
		const placed = new Set<string>();
		const place = (row: StatutoryRow, path: ReadonlySet<string>): void => {
			if (placed.has(row.code) || path.has(row.code)) return;
			for (const code of [...(reads.get(row.code) ?? [])].toSorted())
				place(
					input.statutoryRows.find((other) => other.code === code)!,
					new Set([...path, row.code])
				);
			placed.add(row.code);
			ordered.push(row);
		};
		// `configuration.order` first (lower first), then the code: it decides which share `net_available` caps first.
		const rank = (row: StatutoryRow) => row.configuration?.order ?? Number.MAX_SAFE_INTEGER;
		for (const row of input.statutoryRows.toSorted(
			(left, right) => rank(left) - rank(right) || left.code.localeCompare(right.code)
		))
			place(row, new Set());
		// The employee's declared standing per scheme code, in force on the period's first day.
		const day = input.window.from;
		const standingOf = new Map<
			string,
			{ kind: string; since: string; elections: { [key: string]: Json } }
		>();
		for (const fact of input.standing) {
			const code = input.schemeCodes.get(fact.statutory_contribution_id);
			const { from, to } = fact.effective_range;
			if (code == null || String(from) > day || (to != null && String(to) < day)) continue;
			standingOf.set(code, {
				kind: fact.status.kind,
				since: String(from),
				elections: { ...fact.status.elections }
			});
		}
		const elections = Object.fromEntries(
			[...standingOf].map(([code, standing]) => [code, standing.elections])
		);
		// Every scheme's charges: earlier months of the year, and this month so far (earlier slips plus the schemes this
		// slip has already assessed, in catalogue order).
		const previousMonth = input.history.filter((slip) => slipPeriod(slip) === input.previousMonth);
		const previousYear = input.history.filter(
			(slip) =>
				slipPeriod(slip) < yearStart &&
				slipPeriod(slip) >= String(addMonths(`${yearStart}-01`, -12)).slice(0, 7)
		);
		const charged = {
			year: Object.fromEntries(codes.map((code) => [code, amounts(lines(before, code))])),
			month: Object.fromEntries(codes.map((code) => [code, amounts(lines(monthPrior, code))])),
			previous_month: Object.fromEntries(
				codes.map((code) => [code, amounts(lines(previousMonth, code))])
			),
			previous_year: Object.fromEntries(
				codes.map((code) => [code, amounts(lines(previousYear, code))])
			)
		};
		for (const row of ordered) {
			const configuration = row.configuration;
			if (configuration?.rules == null || configuration.rules.length === 0) continue;
			const where = `statutory_contribution_catalog ${row.code}`;
			const monthLines = lines(monthPrior, row.code);
			const paid = input.wages.get(row.code) ?? new Map<string, number>();
			const parts = new Set([
				...(input.parts.get(row.code) ?? ['ordinary']),
				...paid.keys(),
				...monthLines.flatMap((line) => Object.keys(line.parts ?? {}))
			]);
			if (
				configuration.assess_without_wage !== true &&
				[...paid.values()].every((amount) => amount === 0) &&
				monthLines.length === 0
			)
				continue;
			const prior = partSums(monthLines, parts);
			const wage = Object.fromEntries([...parts].map((part) => [part, paid.get(part) ?? 0]));
			// the month's wage as paid: an earlier slip's assessed part has had `assessable` applied already, and a part
			// that deducts a threshold (`max(0, month.meal - cap)`) applied twice loses it again
			const priorWages = partSums(
				monthLines.map((line) => ({ parts: line.wages ?? line.parts ?? {} })),
				parts
			);
			const monthToDate = Object.fromEntries(
				[...parts].map((part) => [part, (priorWages[part] ?? 0) + (wage[part] ?? 0)])
			);
			// The subject on the scheme's `as_of`: `period_start` (default), `period_end` or `pay_date`.
			const held =
				configuration.as_of == null || configuration.as_of === 'period_start'
					? subject
					: input.subjectOn(configuration.as_of);
			let context: DynObject = {
				...held,
				...input.roots,
				headcount: isDynObject(subject.company) ? (subject.company.headcount ?? 0) : 0,
				wage,
				month: monthToDate,
				year: partSums(lines(before, row.code), parts),
				period: periodFacts,
				rules: input.rules,
				lines: input.lines,
				// What the slip's net still holds for this scheme's employee share, after the schemes assessed before it.
				net_available: money(
					input.available - assessed.reduce((sum, line) => sum + line.employee_amount, 0)
				),
				charged,
				elections,
				scheme: {
					code: row.code,
					standing: standingOf.get(row.code)?.kind ?? '',
					elections: standingOf.get(row.code)?.elections ?? {},
					since: standingOf.get(row.code)?.since ?? ''
				}
			};
			const personFacts: DynObject = {};
			for (const [fact, expression] of Object.entries(configuration.person ?? {})) {
				const value = yield* evaluate(expression, context, `${where} person.${fact}`);
				if (!Schema.is(Schema.Json)(value))
					return yield* Effect.fail(
						new Refusal({ message: `${where}: person.${fact} must return a JSON value.` })
					);
				personFacts[fact] = value;
			}
			context = {
				...context,
				person: { ...(isDynObject(held.person) ? held.person : {}), ...personFacts }
			};
			// Each part's month-to-date assessable amount: the scheme's expression, or the part as paid; never below zero.
			const monthAssessed: { [part: string]: number } = {};
			for (const part of parts) {
				const expression = configuration.assessable?.[part];
				const value =
					expression == null
						? (monthToDate[part] ?? 0)
						: yield* evaluateNumber(expression, context, `${where} assessable.${part}`);
				monthAssessed[part] = money(Math.max(0, value));
			}
			const total = money(Object.values(monthAssessed).reduce((sum, value) => sum + value, 0));
			const baseContext = { ...monthAssessed, assessed: total, amount: total };
			context = { ...context, base: baseContext };
			for (const guard of configuration.refuse_when ?? [])
				if (yield* evaluateBoolean(guard.when, context, where))
					return yield* Effect.fail(new Refusal({ message: `${input.who}: ${guard.message}` }));
			for (const guard of configuration.warn_when ?? [])
				if (yield* evaluateBoolean(guard.when, context, where))
					warnings.push(`${input.who}: ${guard.message}`);
			let charge: { employee: number; employer: number } | null = null;
			let appliedWhen: string | undefined;
			let chargedOn = total;
			for (const rule of configuration.rules) {
				if (!(yield* evaluateBoolean(rule.when, context, where))) continue;
				const assessedOn =
					configuration.assessment == null
						? total
						: yield* evaluateNumber(configuration.assessment, context, where);
				const ruleContext: DynObject = {
					...context,
					base: { ...baseContext, assessed: assessedOn, amount: assessedOn }
				};
				if (rule.contribution != null) {
					const value = yield* evaluate(rule.contribution, ruleContext, where);
					if (!Schema.is(ContributionAmounts)(value))
						return yield* Effect.fail(
							new Refusal({
								message: `${where}: a contribution must return its employee and employer amounts.`
							})
						);
					charge = value;
				} else
					charge = {
						employee:
							rule.employee == null ? 0 : yield* evaluateNumber(rule.employee, ruleContext, where),
						employer:
							rule.employer == null ? 0 : yield* evaluateNumber(rule.employer, ruleContext, where)
					};
				appliedWhen = rule.when;
				chargedOn = assessedOn;
				break;
			}
			// A scheme the month paid wages toward keeps its line even when nothing is charged: a later slip of the month
			// reads the month's earlier wage from these parts.
			const month = charge ?? { employee: 0, employer: 0 };
			const slipParts = Object.fromEntries(
				[...parts].map((part) => [part, money((monthAssessed[part] ?? 0) - (prior[part] ?? 0))])
			);
			assessed.push({
				scheme_code: row.code,
				base_amount: money(Object.values(slipParts).reduce((sum, value) => sum + value, 0)),
				parts: slipParts,
				wages: wage,
				employee_amount: money(
					month.employee - monthLines.reduce((sum, line) => sum + num(line.employee_amount), 0)
				),
				employer_amount: money(
					month.employer - monthLines.reduce((sum, line) => sum + num(line.employer_amount), 0)
				),
				charged_base: money(chargedOn),
				...(appliedWhen == null ? {} : { rule_when: appliedWhen })
			});
			const line = assessed.at(-1)!;
			const sofar = charged.month[row.code] ?? { employee: 0, employer: 0 };
			charged.month[row.code] = {
				employee: money(sofar.employee + line.employee_amount),
				employer: money(sofar.employer + line.employer_amount)
			};
		}
		return { lines: assessed, warnings };
	});
/** The host transform surface an entry collection hands to `transformEntries`. */
export type EntryTransformCtx = {
	readonly existing: readonly (object | undefined)[];
	readonly db: Pick<TransformCtx<string>['db'], 'read'>;
	readonly refuse: (message: string) => never;
};

/**
 * The one transform of the four entry collections: a new or edited entry must name a class of the version in force on
 * its day that its employment is eligible for, and takes its company from the employment. An entry a payslip has
 * consumed is fixed: only the run's own pin may move, and deleting the run releases it.
 */
export const transformEntries = async <C extends EntryCollection, R extends object>(
	collection: C,
	inputs: readonly R[],
	ctx: EntryTransformCtx
): Promise<R[]> => {
	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	// Every admitted input's rows in one read for the whole batch (`entryMembers`), then each judged in memory.
	const admissible = inputs.flatMap((input, i) => {
		const stored = entryRow(ctx.existing[i]);
		if (stored.payslip_id != null || '$delete' in input || pinOnly(input)) return [];
		const merged: LooseEntryRow = { ...stored, ...entryRow(input) };
		return [
			{
				employment_id: String(merged.employment_id ?? ''),
				catalog_id: String(merged.catalog_id ?? ''),
				occurred_on: String(merged.occurred_on ?? '')
			}
		];
	});
	const prefetched =
		admissible.length === 0
			? undefined
			: await runEngine(
					readJoinedSet(entryMembers(collection, admissible)),
					workspaceReadAsHost(ctx.db.read),
					ctx.refuse
				);
	return eachBatched(
		inputs,
		workspaceReadAsHost(ctx.db.read),
		async (input, i, read): Promise<R> => {
			const stored = entryRow(ctx.existing[i]);
			if (stored.payslip_id != null) {
				if ('$delete' in input || !pinOnly(input))
					ctx.refuse('This entry is settled on a payslip. Delete that payroll run to change it.');
				return input;
			}
			if ('$delete' in input || pinOnly(input)) {
				return input;
			}
			const merged: LooseEntryRow = { ...stored, ...entryRow(input) };
			const admitted = await runEngine(
				admitEntry({
					collection,
					id: stored.id ?? null,
					catalog_id: String(merged.catalog_id ?? ''),
					employment_id: String(merged.employment_id ?? ''),
					occurred_on: String(merged.occurred_on ?? ''),
					activity: merged.activity ?? null,
					values: merged,
					...(prefetched === undefined ? {} : { prefetched })
				}),
				read,
				ctx.refuse
			);
			if (collection === 'leave_catalog_entry' && isLeaveAdmitted(collection, admitted)) {
				// the employment as a leave subject and the version's classes came with the admission's one read
				const contract = admitted.leave.subject;
				const catalog = admitted.leave.classes.find((held) => held.id === admitted.catalog_id);
				const coded = Array.isArray(contract?.['leave_catalog_entry'])
					? (contract['leave_catalog_entry'] as readonly (HostRow<'leave_catalog_entry'> & {
							readonly catalog?: { readonly code?: string } | null;
						})[])
					: [];
				const asOf = dayKey(merged.from) ?? dayKey(merged.occurred_on) ?? '';
				const classes = (
					admitted.leave.classes.length > 0
						? admitted.leave.classes
						: catalog == null
							? []
							: [catalog]
				).map(classFromRow);
				const codeOf = new Map([
					...coded.flatMap((row) =>
						row.catalog?.code == null ? [] : [[String(row.catalog_id), row.catalog.code] as const]
					),
					...(catalog == null ? [] : [[String(catalog.id), String(catalog.code)] as const])
				]);
				const subject = await runEngine(
					leaveSubject(
						String(merged.employment_id ?? ''),
						asOf,
						classes.some(readsAttendance),
						// admission found the version governing the entry's day: the subject's day when they are one
						asOf === String(merged.occurred_on ?? '') ? admitted.version : undefined,
						contract ?? undefined
					),
					read,
					ctx.refuse
				);
				// An exit's encashment is judged against the balance without the exit's own unpaid encashments: a moved
				// exit withdraws them in the same act (`retract-exit-effects`), as its balances leave them out.
				const exitPrefix = `exit:${String(merged.employment_id ?? '')}:`;
				const exitOwn = String(merged.reference ?? '').startsWith(exitPrefix);
				const movementPage = {
					rows: coded
						.filter(
							(row) =>
								!(
									exitOwn &&
									row.payslip_id == null &&
									String(row.reference ?? '').startsWith(exitPrefix)
								)
						)
						.map(({ catalog: _catalog, ...row }) => row)
				};
				const message = refuseLeaveWrite({
					context: { ...subject.context, entry: entryContext(merged, asOf) },
					employmentStart: subject.employmentStart,
					...(subject.days === undefined ? {} : { attendanceDays: subject.days }),
					proposed: movementFromRow({
						catalog_id: admitted.catalog_id,
						employment_id: String(merged.employment_id ?? ''),
						activity: merged.activity ?? 'TIME_OFF',
						...(stored?.id === undefined ? {} : { id: stored.id }),
						...(merged.occurred_on === undefined ? {} : { occurred_on: merged.occurred_on }),
						approval_id: stored?.approval_id ?? null,
						days: merged.days ?? null,
						from: merged.from ?? null,
						to: merged.to ?? null,
						facts: merged.facts ?? null
					}),
					classes,
					movements: movementsByCode(movementPage.rows.map(movementFromRow), classes, codeOf),
					serviceMonths: serviceMonthsAt(
						dayKey(contract?.effective_range),
						asOf,
						contract?.prior_service_months
					)
				});
				if (message != null) ctx.refuse(message);
			}
			return { ...input, company_id: admitted.company_id, catalog_id: admitted.catalog_id };
		}
	);
};
