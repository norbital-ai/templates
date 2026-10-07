import { Effect, Result, Schema } from 'effect';
import { fromAbsolute, toCalendarDateTime } from '@internationalized/date';
import { addDays, addMonths, datePeriod, days, intersect, monthOf } from '@norbital-ai/std/date';
import { type Behaviours, planBehaviours } from './behaviours.js';
import { statutoryFactsFromFacts } from './employment_facts.js';
import { evaluateConfigured } from './expressions.js';
import type { Id, TransformCtx } from '@norbital-ai/bolt';
import {
	type DynObject,
	type HostRow,
	type Json,
	type JsonObject,
	completedMonths,
	isDynObject,
	isJsonObject,
	readAll,
	moneyNumber,
	numberOf,
	PAYROLL_TIME_ZONE,
	payPeriodWindow,
	Refusal,
	runEngine,
	stableJson,
	workspaceReadAsHost
} from './foundation.js';
import {
	classFromRow,
	dayKey,
	eventIdOf,
	movementFromRow,
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

const num = (value: unknown, fallback = 0): number => numberOf(value) ?? fallback;

const dayInRange = (day: string, range: CalendarRange): boolean =>
	(range.from == null || day >= range.from) && (range.to == null || day <= range.to);

export type PayrollFrequency = 'MONTHLY' | 'SEMI_MONTHLY' | 'TEN_DAY' | 'WEEKLY' | 'INTEGER_MONTHS';
export type PayrollRunKind = 'REGULAR' | 'OFF_CYCLE';
/** Salary runs pay the contract; settlement runs pay only their selected entries. */
const SALARY_RUNS: readonly PayrollRunKind[] = ['REGULAR'];
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
}

export interface StatutoryRow {
	readonly id: string;
	readonly code: string;
	readonly configuration?: StatutoryConfiguration;
}

export interface SettingsRow {
	readonly id: Id<'jurisdiction_settings'>;
	readonly code: string;
	readonly payroll?: { readonly currency?: string };
	readonly behaviours?: Behaviours;
	readonly effective_range?: CalendarRange;
	readonly sealed_at?: string | null;
	readonly voided_at?: string | null;
}
export interface EntityRow {
	readonly id: string;
	readonly name?: string;
	readonly settings_code: string;
	readonly pay_cutoff_day?: number;
	readonly pay_frequency?: PayrollFrequency;
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
		readonly limit?: { readonly amount?: string; readonly on_exceed?: string } | null;
	}[];
	readonly is_npl?: boolean;
	readonly can_encash?: boolean;
	readonly component_code?: string;
	readonly quantity?: string;
	readonly rate?: string;
	readonly amount?: string;
	readonly prorated?: boolean;
	readonly pay_fraction?: string;
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
	readonly incentive_hours?: number | null;
	readonly payslip_id?: string | null;
}

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
	readonly employment_id?: string;
	readonly from?: string | null;
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
	readonly employee_amount: number;
	readonly employer_amount: number;
	readonly rule_when?: string;
};

export interface PayslipHistoryRow {
	readonly id?: string;
	readonly payroll_run_id?: string;
	readonly employment_id?: string;
	readonly salary_from?: string;
	readonly statutory?: readonly Partial<PayslipStatutoryLine>[];
	readonly base?: readonly { readonly component_code?: string; readonly amount?: unknown }[];
	readonly adjustments?: readonly { readonly component_code?: string; readonly amount?: unknown }[];
	readonly gross?: unknown;
	readonly net?: unknown;
}
/** What each read selects: a host read without `select` leaves json fields out, so every engine read names its fields. */
const pick = (...fields: readonly string[]) =>
	Object.fromEntries(fields.map((field) => [field, true]));
const SETTINGS = pick(
	'id',
	'code',
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
const ROSTER = pick(
	'id',
	'employment_id',
	'work_date',
	'shift_definition_id',
	'worked_intervals',
	'approved_overtime_hours',
	'incentive_hours',
	'payslip_id'
);
const HOLIDAY = pick('id', 'date', 'name', 'kind', 'published_at', 'replaces', 'given_to');
const HISTORY = pick(
	'id',
	'payroll_run_id',
	'employment_id',
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
		'bands'
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
		'bands'
	),
	leave_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'eligibility',
		'is_npl',
		'can_encash',
		'pay_fraction'
	),
	loan_catalog: pick(
		'id',
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'eligibility',
		'bands'
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
		'destination',
		'direction',
		'counts_toward'
	)
} as const;

/** The four entry families: their collection, their catalogue and the run line family they produce. */
const FAMILIES = [
	{ collection: 'adhoc_catalog_entry', catalog: 'adhoc_catalog', family: 'ADHOC' },
	{ collection: 'claim_catalog_entry', catalog: 'claim_catalog', family: 'CLAIM' },
	{ collection: 'leave_catalog_entry', catalog: 'leave_catalog', family: 'LEAVE' },
	{ collection: 'loan_catalog_entry', catalog: 'loan_catalog', family: 'LOAN_REPAYMENT' }
] as const;
type EntryFamily = (typeof FAMILIES)[number];
type EntryCollection = EntryFamily['collection'];
type CatalogName<C extends EntryCollection> = Extract<EntryFamily, { collection: C }>['catalog'];

type LeaveAdmitted = { readonly company_id: string; readonly catalog_id: Id<'leave_catalog'> };

const isLeaveAdmitted = (
	collection: EntryCollection,
	admitted: { readonly company_id: string; readonly catalog_id: Id<CatalogName<EntryCollection>> }
): admitted is LeaveAdmitted => collection === 'leave_catalog_entry';
/** Settlement runs select from these families; leave and loans settle only with salary. */
const SELECTABLE = ['adhoc_catalog_entry', 'claim_catalog_entry'] as const;

const termFor = (contract: ContractRow, day: string): ContractTerm | undefined =>
	(contract.facts?.contract_terms ?? [])
		.filter((term) => term.effective_range != null && dayInRange(day, term.effective_range))
		.sort((left, right) =>
			String(left.effective_range?.from).localeCompare(String(right.effective_range?.from))
		)
		.at(-1);

const moneyValue = (value: unknown): number => moneyNumber(value) ?? 0;

/** How many settlement periods a pay frequency cuts a calendar month into; a weekly cycle has no month grammar. */
const PARTS: { readonly [frequency: string]: number } = {
	MONTHLY: 1,
	INTEGER_MONTHS: 1,
	SEMI_MONTHLY: 2,
	TEN_DAY: 3
};

/** One settlement period inside its calendar month, and where it sits: part `part` of the month's `parts`. */
export type SettlementPeriod = {
	readonly from: string;
	readonly to: string;
	readonly part: number;
	readonly parts: number;
};

/**
 * A run's period key in its entity's grammar: `YYYY-MM` for a monthly entity, `YYYY-MM-<part>` (1-based) for a
 * sub-monthly one (`SEMI_MONTHLY` 1–15 / 16–end, `TEN_DAY` 1–10 / 11–20 / 21–end).
 */
export const settlementPeriod = (
	period: string,
	frequency: string
): Effect.Effect<SettlementPeriod, Refusal> => {
	const parts = PARTS[frequency];
	if (parts == null)
		return Effect.fail(
			new Refusal({
				message: `Payroll frequency ${frequency} requires its own settlement calendar.`
			})
		);
	const shape = parts === 1 ? /^\d{4}-\d{2}$/ : new RegExp(`^\\d{4}-\\d{2}-[1-${parts}]$`);
	if (!shape.test(period))
		return Effect.fail(
			new Refusal({
				message:
					parts === 1
						? 'A payroll run needs its pay period as YYYY-MM.'
						: `A ${frequency} payroll run needs its pay period as YYYY-MM-<1–${parts}>.`
			})
		);
	return Effect.try({
		try: () => {
			const { start, end } = payPeriodWindow(period, { pay_frequency: frequency });
			return { from: start, to: end, part: parts === 1 ? 1 : Number(period.slice(8)), parts };
		},
		catch: (cause) =>
			cause instanceof Refusal
				? cause
				: new Refusal({ message: 'A pay period requires its actual calendar month.' })
	});
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
export const governingVersion = (
	entity: Pick<EntityRow, 'settings_code'>,
	day: string
): Effect.Effect<SettingsRow, Refusal> =>
	Effect.gen(function* () {
		const version = (yield* readAll<SettingsRow>(
			'jurisdiction_settings',
			{
				code: { eq: entity.settings_code },
				approval_id: { isNull: true },
				voided_at: { isNull: true },
				sealed_at: { isNull: false }
			},
			undefined,
			SETTINGS
		))
			.filter((row) => row.effective_range != null && dayInRange(day, row.effective_range))
			.sort((left, right) =>
				String(left.effective_range?.from).localeCompare(String(right.effective_range?.from))
			)
			.at(-1);
		if (version == null)
			return yield* Effect.fail(
				new Refusal({
					message: `No sealed ${entity.settings_code} jurisdiction version governs ${day}.`
				})
			);
		return version;
	});

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

/**
 * Admit one payroll run request: its entity, the version governing its period, the behaviour that admits its kind,
 * no second salary run for the period, and — for a settlement run — only approved, unpaid ad hoc or claim entries.
 * The run collection's transform and the run build both admit through here.
 */
export const admitPayrollRun = (request: PayrollRunRequest) =>
	Effect.gen(function* () {
		const entity = yield* entityOf(request.company_id);
		const settlement = yield* settlementPeriod(request.period, entity.pay_frequency ?? 'MONTHLY');
		const version = yield* governingVersion(entity, settlement.from);
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
		const salaryRun = SALARY_RUNS.includes(request.kind);
		const runs = yield* readAll<{ id: string; kind?: string; period?: string }>(
			'payroll_run',
			{ company_id: { eq: request.company_id } },
			undefined,
			{ id: true, kind: true, period: true }
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
		const sources = request.sources ?? [];
		if (!salaryRun) {
			if (sources.length === 0)
				return yield* Effect.fail(
					new Refusal({
						message:
							'An off-cycle or correction run pays only the ad hoc or claim entries it selects; select at least one.'
					})
				);
			const open = new Set<string>();
			for (const collection of SELECTABLE)
				for (const row of yield* readAll<EntryRow>(
					collection,
					{
						id: { in: sources },
						company_id: { eq: request.company_id },
						approval_id: { isNull: true },
						payslip_id: { isNull: true }
					},
					undefined,
					pick('id')
				))
					open.add(row.id);
			const missing = sources.filter((id) => !open.has(id));
			if (missing.length > 0)
				return yield* Effect.fail(
					new Refusal({
						message: `${missing.length} selected entr${missing.length === 1 ? 'y is' : 'ies are'} not an approved, unpaid ad hoc or claim entry of this company.`
					})
				);
		}
		return { entity, version, settlement, salaryRun, sources, runs };
	});

/**
 * The subject of a rule — the person, the company, the contract terms in force and the employment — as the CEL roots
 * `employee`, `company`, `terms`, `employment` and `person`. Every site shares it; what a rule reads from it is the
 * record's business.
 */
const subjectContext = (input: {
	readonly contract: Pick<ContractRow, 'effective_range' | 'exit_ground' | 'exit_facts'> & {
		readonly prior_service_months?: number | null;
	};
	readonly employee: EmployeeRow | undefined;
	readonly entity: EntityRow | undefined;
	readonly term: ContractTerm | undefined;
	readonly day: string;
	/** The entity's contracts in force on the day. */
	readonly headcount: number;
}): DynObject => {
	const { contract, employee, entity, term, day } = input;
	const from = contract.effective_range?.from;
	const employment = {
		classification: term?.work_classification ?? '',
		service_months:
			num(contract.prior_service_months) +
			(from == null || from === '' ? 0 : Math.max(0, completedMonths(from, day))),
		start_date: from ?? '',
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
			work_classification: term?.work_classification ?? '',
			statutory_work_category: term?.statutory_work_category ?? '',
			employment_type: term?.employment_type ?? '',
			facts: isDynObject(term?.facts) ? term.facts : {},
			residency_status: term?.residency_status ?? '',
			residency_since: term?.residency_since ?? '',
			base_salary,
			/** The contract's monthly wage: base salary plus its fixed allowances. */
			monthly_wage:
				base_salary +
				(term?.allowances ?? []).reduce((total, line) => total + moneyValue(line.amount), 0)
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
	return isDynObject(subject) ? subject : {};
};

/** How many of the entity's contracts are in force on a day: the CEL `company.headcount` (and `headcount`). */
const inForce = (contracts: readonly Pick<ContractRow, 'effective_range'>[], day: string): number =>
	contracts.filter((contract) => dayInRange(day, contract.effective_range ?? {})).length;

export const headcountOn = (company_id: string, day: string) =>
	readAll<Pick<ContractRow, 'id' | 'effective_range'>>(
		'employment_contract',
		{ company_id: { eq: company_id }, approval_id: { isNull: true } },
		undefined,
		pick('id', 'effective_range')
	).pipe(Effect.map((contracts) => inForce(contracts, day)));

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
	site: Schema.Literals(['contract', 'payslip']),
	kind: Schema.Literals(['refuse', 'warn', 'hold']),
	when: Schema.String,
	message: Schema.String,
	description: Schema.optional(Schema.String)
});
type Validation = typeof Validation.Type & { readonly code: string };

const versionValidations = (version: SettingsRow, site: Validation['site']) =>
	Effect.gen(function* () {
		const rows = yield* readAll<{ code: string; rules?: unknown }>(
			'rule_set',
			{ settings_id: { eq: version.id }, family: { eq: 'VALIDATIONS' } },
			undefined,
			RULES
		);
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
		for (const term of changed) {
			const day = String(term.effective_range!.from);
			const governing = yield* Effect.result(governingVersion(entity, day));
			if (Result.isFailure(governing)) continue;
			const version = governing.success;
			const checks = yield* versionValidations(version, 'contract');
			if (checks.length === 0) continue;
			const subject = subjectContext({
				contract,
				employee,
				entity,
				term,
				day,
				headcount: yield* headcountOn(contract.company_id, day)
			});
			const context: DynObject = {
				...subject,
				rules: yield* versionRules(version),
				term: subject.terms ?? {},
				day
			};
			const [first] = (yield* tripped(checks, context)).filter((check) => check.kind === 'refuse');
			if (first != null) return yield* Effect.fail(new Refusal({ message: first.message }));
		}
	});

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
}): Effect.Effect<
	{ readonly company_id: string; readonly catalog_id: Id<CatalogName<C>> },
	Refusal
> =>
	Effect.gen(function* () {
		const family = FAMILIES.find((candidate) => candidate.collection === input.collection)!;
		const [contract] = yield* readAll<ContractRow>(
			'employment_contract',
			{ id: { eq: input.employment_id } },
			undefined,
			CONTRACT
		);
		if (contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This entry needs an actual employment.' }));
		const range = contract.effective_range ?? {};
		if (!dayInRange(input.occurred_on, range))
			return yield* Effect.fail(
				new Refusal({ message: 'The entry day falls outside the employment.' })
			);
		const entity = yield* entityOf(contract.company_id);
		const version = yield* governingVersion(entity, input.occurred_on);
		// A class is its code: the entry is pinned to that code's row in the version in force on its day.
		const [picked] = yield* readAll<
			CatalogRow & { readonly id: Id<CatalogName<C>>; settings_id?: string }
		>(family.catalog, { id: { eq: input.catalog_id } }, undefined, CATALOG[family.catalog]);
		if (picked == null)
			return yield* Effect.fail(new Refusal({ message: 'Choose the entry’s class.' }));
		const row =
			picked.settings_id === version.id
				? picked
				: (yield* readAll<CatalogRow & { readonly id: Id<CatalogName<C>> }>(
						family.catalog,
						{ settings_id: { eq: version.id }, code: { eq: picked.code } },
						undefined,
						CATALOG[family.catalog]
					))[0];
		if (row == null)
			return yield* Effect.fail(
				new Refusal({
					message: `${picked.name ?? picked.code} is not a class of the ${version.code} version in force on ${input.occurred_on}.`
				})
			);
		const term = termFor(contract, input.occurred_on);
		const [employee] = yield* readAll<EmployeeRow>(
			'employment_profile',
			{ id: { eq: contract.employee_id } },
			undefined,
			PROFILE
		);
		const values = input.values ?? {};
		if (family.family !== 'LEAVE' && !(moneyValue(values.amount) > 0))
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
				headcount: yield* headcountOn(contract.company_id, input.occurred_on)
			}),
			rules: yield* versionRules(version),
			entry: entryContext(values, input.occurred_on),
			earlier: earlierContext(yield* familySiblings(input.collection, [contract.id]), {
				code: row.code,
				occurred_on: input.occurred_on,
				...(input.id == null ? {} : { id: input.id })
			})
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
		return { company_id: contract.company_id, catalog_id: row.id };
	});

/** The part of a scheme one `counts_toward` target names: `CPF.ADDITIONAL` → CPF's `additional`; a bare code → `ordinary`. */
const schemePart = (target: string): [scheme: string, part: string] => {
	const [scheme = '', part = 'ORDINARY'] = target.split('.');
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
 * and each scheme's employee and employer charge under `statutory`. */
const slipSums = (slips: readonly PayslipHistoryRow[]): DynObject => {
	const lines: { [code: string]: number } = {};
	const statutory: { [code: string]: { employee: number; employer: number } } = {};
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
			const held = statutory[code] ?? { employee: 0, employer: 0 };
			statutory[code] = {
				employee: round2(held.employee + num(line.employee_amount)),
				employer: round2(held.employer + num(line.employer_amount))
			};
		}
	}
	return { ...lines, gross: round2(gross), net: round2(net), statutory };
};

/**
 * What the employment earned before this slip, from its stored payslips: `month` (earlier slips of this period),
 * `year` (earlier periods of the calendar year) and `previous_month` (the previous period's salary-run slips, with
 * the base salary of the terms then in force).
 */
const earnedFrom = (input: {
	readonly history: readonly PayslipHistoryRow[];
	readonly period: string;
	readonly runKind: ReadonlyMap<string, string>;
	readonly contract: ContractRow;
}): DynObject => {
	const { history, period } = input;
	const previous = String(monthOf(addDays(`${period}-01`, -1)).from).slice(0, 7);
	const previousSlips = history.filter(
		(slip) =>
			slipPeriod(slip) === previous &&
			isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
	);
	return {
		month: slipSums(history.filter((slip) => slipPeriod(slip) === period)),
		year: slipSums(
			history.filter(
				(slip) => slipPeriod(slip).startsWith(period.slice(0, 4)) && slipPeriod(slip) < period
			)
		),
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

/** One planned and recorded person-day as the CEL root `work.days[]` reads it. */
const workDay = (input: {
	readonly date: string;
	readonly planned: PlannedShift | null;
	readonly row: RosterRow | undefined;
	readonly holiday: HolidayRow | undefined;
	readonly zone: string;
}): JsonObject => {
	const { row } = input;
	const stored = Schema.is(IntervalList)(row?.worked_intervals) ? row.worked_intervals : [];
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
		overtime_hours: num(row?.approved_overtime_hours),
		incentive_hours: num(row?.incentive_hours),
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
	readonly rows: readonly RosterRow[];
	readonly holidays: ReadonlyMap<string, HolidayRow>;
	readonly month: { readonly from: string; readonly to: string };
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
				overtime_hours: num(day.overtime_hours),
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
		previous_month: [String(addMonths(month.from, -1)), String(addDays(month.from, -1))],
		year: [`${month.from.slice(0, 4)}-01-01`, month.to],
		rolling: [String(addMonths(month.from, 1 - ROLLING_MONTHS)), month.to]
	};
	const out: DynObject = {};
	for (const [name, [from, to]] of Object.entries(windows)) {
		let total: HourSums = { worked_hours: 0, overtime_hours: 0, incentive_hours: 0 };
		const day_type: { [type: string]: HourSums } = {};
		const holiday_kind: { [kind: string]: HourSums } = {};
		for (const day of recorded) {
			if (day.date < from || day.date > to) continue;
			total = add(total, day.sums);
			if (day.day_type !== '') day_type[day.day_type] = add(day_type[day.day_type], day.sums);
			if (day.holiday_kind !== '')
				holiday_kind[day.holiday_kind] = add(holiday_kind[day.holiday_kind], day.sums);
		}
		out[name] = { ...total, day_type, holiday_kind };
	}
	return out;
};

/** The earliest roster day `hours` reads for a period starting on `from`: January, or the rolling window's start. */
const hoursStart = (from: string): string => {
	const rolling = String(addMonths(String(monthOf(from).from), 1 - ROLLING_MONTHS));
	const january = `${from.slice(0, 4)}-01-01`;
	return rolling < january ? rolling : january;
};

/**
 * The subject a leave entitlement is read on, for one employment at one day: the person, the company, the terms in
 * force, the employment and what it earned (`earned`) — and the employment's start for service-year windows.
 */
export const leaveSubject = (employment_id: string, asOf: string) =>
	Effect.gen(function* () {
		const [contract] = yield* readAll<ContractRow>(
			'employment_contract',
			{ id: { eq: employment_id } },
			undefined,
			CONTRACT
		);
		if (contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This entry needs an actual employment.' }));
		const [entity] = yield* readAll<EntityRow>(
			'entity',
			{ id: { eq: contract.company_id } },
			undefined,
			ENTITY
		);
		const [employee] = yield* readAll<EmployeeRow>(
			'employment_profile',
			{ id: { eq: contract.employee_id } },
			undefined,
			PROFILE
		);
		const history = yield* readAll<PayslipHistoryRow>(
			'payslip',
			{ employment_id: { eq: employment_id } },
			undefined,
			HISTORY
		);
		const runIds = [...new Set(history.map((slip) => String(slip.payroll_run_id ?? '')))];
		const runs = yield* readAll<{ id: string; kind?: string }>(
			'payroll_run',
			{ id: { in: runIds } },
			undefined,
			pick('id', 'kind')
		);
		const context: DynObject = {
			...subjectContext({
				contract,
				employee,
				entity,
				term: termFor(contract, asOf),
				day: asOf,
				headcount: yield* headcountOn(contract.company_id, asOf)
			}),
			earned: earnedFrom({
				history,
				period: asOf.slice(0, 7),
				runKind: new Map(runs.map((run) => [run.id, run.kind ?? ''])),
				contract
			})
		};
		return { context, employmentStart: contract.effective_range?.from ?? null };
	});

/**
 * One employment's leave state on a day: the leave classes of the version in force, every movement of the employment,
 * its length of service and the entitlement subject. Leave balances, previews and the exit encashment read it.
 */
export const leaveState = (employment_id: string, asOf: string) =>
	Effect.gen(function* () {
		const [contract] = yield* readAll<ContractRow>(
			'employment_contract',
			{ id: { eq: employment_id } },
			undefined,
			CONTRACT
		);
		if (contract == null)
			return yield* Effect.fail(new Refusal({ message: 'This entry needs an actual employment.' }));
		const version = yield* governingVersion(yield* entityOf(contract.company_id), asOf);
		const classes = yield* readAll<HostRow<'leave_catalog'>>(
			'leave_catalog',
			{ settings_id: { eq: version.id } },
			undefined,
			pick('id', 'code', 'name', 'can_encash', 'is_npl', 'consumes_code', 'entitlement')
		);
		const movements = yield* readAll<HostRow<'leave_catalog_entry'>>(
			'leave_catalog_entry',
			{ employment_id: { eq: employment_id } },
			undefined,
			pick(
				'id',
				'catalog_id',
				'employment_id',
				'activity',
				'occurred_on',
				'approval_id',
				'days',
				'from',
				'to',
				'facts'
			)
		);
		const subject = yield* leaveSubject(employment_id, asOf);
		return {
			asOf,
			context: subject.context,
			employmentStart: subject.employmentStart,
			classes: classes.map(classFromRow),
			movements: movements.map(movementFromRow),
			serviceMonths: serviceMonthsAt(
				contract.effective_range?.from ?? null,
				asOf,
				contract.prior_service_months
			)
		};
	});

/** Assemble one payroll run and its payslips from the records in force; nothing is written here. */
export const buildPayrollRun = (request: PayrollRunRequest): Effect.Effect<PayrollPlan, Refusal> =>
	Effect.gen(function* () {
		const { entity, version, settlement, salaryRun, sources, runs } =
			yield* admitPayrollRun(request);
		const window = payrollWindow(settlement, entity.pay_cutoff_day ?? 1);
		const currency = version.payroll?.currency;
		if (currency == null || currency === '')
			return yield* Effect.fail(
				new Refusal({ message: `${version.code} names no payroll currency.` })
			);
		const contracts = yield* readAll<ContractRow>(
			'employment_contract',
			{
				company_id: { eq: request.company_id },
				approval_id: { isNull: true }
			},
			undefined,
			CONTRACT
		);
		const contractIds = contracts.map((contract) => contract.id);
		const employeeIds = [...new Set(contracts.map((contract) => contract.employee_id))];
		const employees =
			employeeIds.length === 0
				? []
				: yield* readAll<EmployeeRow>(
						'employment_profile',
						{ id: { in: employeeIds } },
						undefined,
						PROFILE
					);
		const byEmployee = new Map(employees.map((employee) => [employee.id, employee]));
		const statutoryRows = yield* readAll<StatutoryRow>(
			'statutory_contribution_catalog',
			{ settings_id: { eq: version.id } },
			undefined,
			STATUTORY
		);
		// A statutory standing names one version's scheme row; every version of the lineage maps its row ids to the code.
		const lineage = yield* readAll<{ readonly id: string }>(
			'jurisdiction_settings',
			{ code: { eq: version.code } },
			undefined,
			pick('id')
		);
		const schemeCodes = new Map(
			(yield* readAll<StatutoryRow>(
				'statutory_contribution_catalog',
				{ settings_id: { in: lineage.map((row) => row.id) } },
				undefined,
				pick('id', 'code')
			)).map((row) => [row.id, row.code])
		);
		const workRows = yield* readAll<CatalogRow>(
			'work_catalog',
			{ settings_id: { eq: version.id } },
			undefined,
			CATALOG.work_catalog
		);
		const allowanceRows = yield* readAll<CatalogRow>(
			'allowance_catalog',
			{ settings_id: { eq: version.id } },
			undefined,
			CATALOG.allowance_catalog
		);
		const rules = yield* versionRules(version);
		const validations = yield* versionValidations(version, 'payslip');
		// Entries name their class by the row of the version they were captured under; the governing version prices it by code.
		const entries = new Map<string, readonly EntryRow[]>();
		// Every entry of each priced family, paid or not: a class reads the employment's earlier ones (`earlier`).
		const siblings = new Map<string, readonly EarlierRow[]>();
		const classes = new Map<string, CatalogRow>();
		const governingRows: CatalogRow[] = [...workRows, ...allowanceRows];
		for (const family of FAMILIES) {
			const rows =
				contractIds.length === 0
					? []
					: yield* readAll<EntryRow>(
							family.collection,
							{
								employment_id: { in: contractIds },
								approval_id: { isNull: true },
								payslip_id: { isNull: true }
							},
							undefined,
							ENTRY[family.collection]
						);
			entries.set(family.collection, rows);
			if (family.family !== 'LEAVE')
				siblings.set(family.collection, yield* familySiblings(family.collection, contractIds));
			const named = [
				...new Set(rows.map((row) => row.catalog_id).filter((id): id is string => id != null))
			];
			const captured =
				named.length === 0
					? []
					: yield* readAll<CatalogRow>(
							family.catalog,
							{ id: { in: named } },
							undefined,
							CATALOG[family.catalog]
						);
			const governing = yield* readAll<CatalogRow>(
				family.catalog,
				{ settings_id: { eq: version.id } },
				undefined,
				CATALOG[family.catalog]
			);
			governingRows.push(...governing);
			const byCode = new Map(governing.map((row) => [row.code, row]));
			for (const row of captured) {
				const priced = byCode.get(row.code);
				if (priced != null) classes.set(row.id, priced);
			}
		}
		// One roster and one holiday read serve the attendance window and `hours`: every approved roster day, paid or not,
		// from January (or the rolling window's start) through the month's end.
		const attended = (day: string) => day >= window.attendance_from && day <= window.attendance_to;
		const monthEnd = String(monthOf(window.salary_from).to);
		const span = {
			gte: [hoursStart(window.salary_from), window.attendance_from].toSorted()[0]!,
			lte: [monthEnd, window.attendance_to].toSorted()[1]!
		};
		const rosterRead =
			contractIds.length === 0
				? []
				: yield* readAll<RosterRow>(
						'roster_entry',
						{
							employment_id: { in: contractIds },
							approval_id: { isNull: true },
							work_date: span
						},
						undefined,
						ROSTER
					);
		const roster = !salaryRun
			? []
			: rosterRead.filter((row) => row.payslip_id == null && attended(row.work_date));
		const hoursRoster = rosterRead.filter((row) => row.work_date <= monthEnd);
		const holidayRead = yield* readAll<HolidayRow>(
			'holiday',
			{ company_id: { eq: request.company_id }, date: span, published_at: { isNull: false } },
			undefined,
			HOLIDAY
		);
		const holidays = !salaryRun ? [] : holidayRead.filter((holiday) => attended(holiday.date));
		const hoursHolidays = new Map(holidayRead.map((holiday) => [holiday.date, holiday]));
		const history =
			contractIds.length === 0
				? []
				: yield* readAll<PayslipHistoryRow>(
						'payslip',
						{ employment_id: { in: contractIds } },
						undefined,
						HISTORY
					);
		const definitions = new Map(
			(yield* readAll<ShiftDefinitionRow>(
				'shift_definition',
				{ company_id: { eq: request.company_id } },
				undefined,
				pick('id', 'code', 'variant')
			)).map((row) => [row.id, row])
		);
		const patterns = new Map(
			(yield* readAll<ShiftPatternRow>(
				'shift_pattern',
				{ company_id: { eq: request.company_id } },
				undefined,
				pick('id', 'pattern', 'effective_range')
			)).map((row) => [row.id, row])
		);
		// An absence event's first day, across every movement of the event: a row's month of the event counts from it.
		const eventStart = new Map<string, string>();
		for (const row of contractIds.length === 0
			? []
			: yield* readAll<LeaveEventRow>(
					'leave_catalog_entry',
					{ employment_id: { in: contractIds }, activity: { eq: 'TIME_OFF' } },
					undefined,
					pick('employment_id', 'from', 'occurred_on', 'facts')
				)) {
			const event = eventIdOf(row.facts);
			const day = String(row.from ?? row.occurred_on ?? '');
			if (event == null || day === '') continue;
			const key = `${row.employment_id}:${event}`;
			const held = eventStart.get(key);
			if (held == null || day < held) eventStart.set(key, day);
		}
		const runKind = new Map(runs.map((run) => [run.id, run.kind ?? '']));
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
				definitions,
				patterns,
				eventStart,
				validations
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
				pay_date: request.pay_due_date ?? window.salary_to,
				pay_due_date: request.pay_due_date ?? window.salary_to,
				salary_from: window.salary_from,
				salary_to: window.salary_to,
				attendance_from: window.attendance_from,
				attendance_to: window.attendance_to
			},
			payslips,
			warnings: payslips.flatMap((slip) => slip.warnings)
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
	readonly definitions: ReadonlyMap<string, ShiftDefinitionRow>;
	readonly patterns: ReadonlyMap<string, ShiftPatternRow>;
	readonly eventStart: ReadonlyMap<string, string>;
	readonly validations: readonly Validation[];
}): Effect.Effect<PayslipPlan | null, Refusal> =>
	Effect.gen(function* () {
		const { contract, employee, period, window, salaryRun } = options;
		const who = employee?.name ?? contract.id;
		// Month-to-date (earned, statutory) is per calendar month; the settlement period may be a part of it.
		const calendar = monthOf(window.salary_from);
		const monthKey = window.salary_from.slice(0, 7);
		const periodParts = {
			part: options.settlement.part,
			parts: options.settlement.parts,
			month_key: monthKey,
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
		const term = termFor(contract, employed == null ? window.salary_to : employedTo);
		const monthDays = days(month);
		const paidDays = salaryRun && employed != null ? days(employed) : 0;
		const baseSalary = moneyValue(term?.base_salary);
		// Roster facts as recorded: the days, the hours they carry and the published holidays they fall on. Which of
		// them a jurisdiction pays, and at how many hours a day, is the work catalogue's CEL.
		const byDate = new Map(options.holidays.map((holiday) => [holiday.date, holiday]));
		const holidays = options.roster.flatMap((row) => {
			const holiday = byDate.get(row.work_date);
			return holiday == null
				? []
				: [
						{
							date: holiday.date,
							name: holiday.name ?? '',
							kind: holiday.kind,
							given_to: holiday.given_to ?? '',
							replaces: holiday.replaces ?? ''
						}
					];
		});
		// The planned shift of every day and what the roster recorded on it, in the entity's time zone.
		const rosterOn = new Map(options.roster.map((row) => [row.work_date, row]));
		const planOn = dayPlanner({
			contract,
			fallback: term,
			roster: rosterOn,
			definitions: options.definitions,
			patterns: options.patterns
		});
		const zone = options.entity.time_zone ?? PAYROLL_TIME_ZONE;
		const employedOn = (date: string) => dayInRange(date, contract.effective_range ?? {});
		const workDays = datesFrom(window.attendance_from, window.attendance_to)
			.filter(employedOn)
			.map((date) =>
				workDay({
					date,
					planned: planOn(date),
					row: rosterOn.get(date),
					holiday: byDate.get(date),
					zone
				})
			);
		const hours = hoursFrom({
			rows: options.hoursRoster,
			holidays: options.hoursHolidays,
			month: { from: String(calendar.from), to: String(calendar.to) },
			planOn: dayPlanner({
				contract,
				fallback: term,
				roster: new Map(options.hoursRoster.map((row) => [row.work_date, row])),
				definitions: options.definitions,
				patterns: options.patterns
			}),
			zone
		});
		const periodExtras = {
			...periodParts,
			/** Working days of the period no-pay leave covers; set once the leave rows are priced. */
			unpaid_working_days: 0,
			covered_days: employed == null ? 0 : days(employed),
			working_days: datesFrom(window.salary_from, window.salary_to).filter(
				(date) => planOn(date)?.day_type === 'WORK'
			).length,
			covered_working_days: datesFrom(window.salary_from, window.salary_to).filter(
				(date) => employedOn(date) && planOn(date)?.day_type === 'WORK'
			).length
		};
		const work: DynObject = {
			overtime_hours: options.roster.reduce(
				(total, row) => total + num(row.approved_overtime_hours),
				0
			),
			incentive_hours: options.roster.reduce((total, row) => total + num(row.incentive_hours), 0),
			dates: options.roster.map((row) => row.work_date),
			holidays,
			holiday_dates: options.holidays.map((holiday) => holiday.date),
			days: workDays
		};
		const earned = earnedFrom({
			history: options.history,
			period: monthKey,
			runKind: options.runKind,
			contract
		});
		const periodRoot: DynObject = {
			key: period,
			from: window.salary_from,
			to: window.salary_to,
			days: monthDays,
			paid_days: paidDays,
			...periodExtras
		};
		const context: DynObject = {
			...subjectContext({
				contract,
				employee,
				entity: options.entity,
				term,
				day: window.salary_to,
				headcount: options.headcount
			}),
			rules: options.rules,
			period: periodRoot,
			work,
			earned,
			hours,
			leave: {}
		};
		const wages = new Map<string, Map<string, number>>();
		const base: PayslipPlan['base'][number][] = [];
		const proration: PayslipPlan['proration'][number][] = [];
		const adjustments: PayslipLine[] = [];
		const pins: PayslipPlan['pins'][number][] = [];
		let gross = 0;
		let netAdd = 0;
		let netSubtract = 0;
		/** One priced line: PAY lines move gross and the scheme parts they count toward; NET lines move only the net. */
		const post = (row: CatalogRow, amount: number) => {
			const signed = row.direction === 'SUBTRACT' ? -amount : amount;
			if (row.destination === 'PAY') {
				gross += signed;
				for (const target of row.counts_toward ?? []) {
					const [scheme, part] = schemePart(target);
					const held = wages.get(scheme) ?? new Map<string, number>();
					held.set(part, (held.get(part) ?? 0) + signed);
					wages.set(scheme, held);
				}
			} else if (row.destination === 'NET') {
				if (signed >= 0) netAdd += signed;
				else netSubtract -= signed;
			}
			return signed;
		};

		if (salaryRun) {
			if (term == null || paidDays === 0) return null;
			if (baseSalary <= 0)
				return yield* Effect.fail(
					new Refusal({
						message: `${who}: the contract in force for ${period} carries no base salary.`
					})
				);
			// The window's leave rows are projected once, generically: the class's own flags beside the row's stored
			// values. Which days become no-pay or cash is the work catalogue's record to decide, never this engine's.
			const leaveFamily = options.entries.find((family) => family.family === 'LEAVE');
			const leaveRows: Json[] = [];
			const unpaidDays = new Set<string>();
			for (const row of leaveFamily?.rows ?? []) {
				const day = String(row.from ?? row.occurred_on ?? '');
				if (day < window.salary_from || day > window.salary_to) continue;
				const held = options.classes.get(String(row.catalog_id));
				const facts = isDynObject(row.facts) ? row.facts : {};
				const event = eventIdOf(row.facts);
				const projected: DynObject = {
					code: held?.code ?? '',
					activity: row.activity ?? 'TIME_OFF',
					days: num(row.days),
					from: day,
					to: String(row.to ?? day),
					is_npl: held?.is_npl === true,
					can_encash: held?.can_encash === true,
					event_id: event ?? '',
					month_index:
						completedMonths(
							(event == null ? undefined : options.eventStart.get(`${contract.id}:${event}`)) ??
								day,
							day
						) + 1,
					facts
				};
				const fraction = held?.pay_fraction;
				const payFraction =
					fraction == null || fraction.trim() === ''
						? 1
						: yield* evaluateNumber(
								fraction,
								{ ...context, entry: entryContext(row, day), leave: projected },
								`leave_catalog ${held?.code ?? ''} pay_fraction`
							);
				leaveRows.push({ ...projected, pay_fraction: payFraction });
				if (held?.is_npl === true || payFraction === 0)
					for (const date of datesFrom(day, String(row.to ?? day)))
						if (date <= window.salary_to && employedOn(date) && planOn(date)?.day_type === 'WORK')
							unpaidDays.add(date);
				pins.push({ collection: 'leave_catalog_entry', id: row.id });
			}
			context.leave = { rows: leaveRows };
			periodExtras.unpaid_working_days = unpaidDays.size;
			periodRoot.unpaid_working_days = unpaidDays.size;
			for (const row of options.workRows) {
				const where = `work_catalog ${row.code}`;
				if (!(yield* evaluateBoolean(row.eligibility, context, where))) continue;
				const quantity = yield* evaluateNumber(row.quantity ?? '1.0', context, where);
				const rate = yield* evaluateNumber(row.rate ?? '0.0', context, where);
				const amount = round2(quantity * rate);
				if (amount === 0) continue;
				const signed = post(row, amount);
				const code = row.component_code ?? row.code;
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
						from: employedFrom,
						to: employedTo,
						days: paidDays,
						denominator: monthDays,
						contract_amount: round2(rate),
						prorated_amount: signed
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
			const unknownIds = capturedAllowances
				.map((line) => line.catalogue_id)
				.filter((id): id is string => id != null && !allowanceById.has(id));
			const capturedRows =
				unknownIds.length === 0
					? []
					: yield* readAll<CatalogRow>(
							'allowance_catalog',
							{ id: { in: unknownIds } },
							undefined,
							CATALOG.allowance_catalog
						);
			const capturedCode = new Map(capturedRows.map((row) => [row.id, row.code]));
			for (const line of capturedAllowances) {
				const code =
					line.code ??
					(line.catalogue_id == null
						? undefined
						: (allowanceById.get(line.catalogue_id)?.code ?? capturedCode.get(line.catalogue_id)));
				const row = code == null ? undefined : allowanceByCode.get(code);
				if (row == null)
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: a contract allowance names no allowance class of ${options.version.code}.`
						})
					);
				const where = `allowance_catalog ${row.code}`;
				const allowanceContext: DynObject = {
					...context,
					allowance: { code: row.code, amount: moneyValue(line.amount) }
				};
				if (!(yield* evaluateBoolean(row.eligibility, allowanceContext, where))) continue;
				if (row.amount == null)
					return yield* Effect.fail(
						new Refusal({ message: `${where}: the class states no amount expression.` })
					);
				const amount = round2(yield* evaluateNumber(row.amount, allowanceContext, where));
				if (amount === 0) continue;
				base.push({
					component_code: row.code,
					label: row.name ?? row.code,
					amount: post(row, amount)
				});
			}
		}

		for (const family of options.entries) {
			if (family.family === 'LEAVE') continue;
			for (const row of family.rows) {
				const chosen = options.selected.has(row.id);
				if (!salaryRun && !chosen) continue;
				if (salaryRun && options.selected.size > 0 && !chosen) continue;
				const occurred = String(row.occurred_on ?? '');
				if (salaryRun && (occurred < window.salary_from || occurred > window.salary_to)) continue;
				const priced = options.classes.get(String(row.catalog_id));
				if (priced == null)
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: entry ${row.id} names a class ${options.version.code} does not carry.`
						})
					);
				if (priced.destination === 'EMPLOYER' || priced.destination === 'DISPLAY') continue;
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
				for (const band of priced.bands ?? []) {
					if (!(yield* evaluateBoolean(band.when, entryCtx, where))) continue;
					priceAmount = yield* evaluateNumber(band.amount, entryCtx, where);
					if (band.limit?.amount != null && band.limit.on_exceed !== 'ALLOW')
						priceAmount = Math.min(
							priceAmount,
							yield* evaluateNumber(band.limit.amount, entryCtx, where)
						);
					break;
				}
				const reversal = row.activity === 'REVERSAL';
				const signedAmount = round2(reversal ? -priceAmount : priceAmount);
				if (signedAmount === 0) continue;
				const posted = post(
					reversal
						? { ...priced, direction: priced.direction === 'SUBTRACT' ? 'ADD' : 'SUBTRACT' }
						: priced,
					Math.abs(signedAmount)
				);
				adjustments.push({
					family: family.family,
					source_id: row.id,
					component_code: priced.code,
					bucket: posted >= 0 && priced.destination === 'PAY' ? 'EARNING' : 'DEDUCTION',
					destination: priced.destination === 'PAY' ? 'PAY' : 'NET',
					amount: posted,
					label: row.label ?? priced.name ?? priced.code
				});
				pins.push({ collection: family.collection, id: row.id });
			}
		}

		gross = round2(gross);
		if (gross === 0 && adjustments.length === 0) return null;
		const { lines: statutory, warnings } = yield* assessStatutory({
			who,
			subject: subjectContext({
				contract,
				employee,
				entity: options.entity,
				term,
				day: window.salary_from,
				headcount: options.headcount
			}),
			rules: options.rules,
			statutoryRows: options.statutoryRows,
			schemeCodes: options.schemeCodes,
			standing: statutoryFactsFromFacts(employee?.facts),
			period,
			window: { from: window.salary_from, to: window.salary_to },
			periodExtras,
			roots: { work, earned, hours },
			wages,
			parts: options.parts,
			history: options.history,
			runKind: options.runKind
		});
		const employeeStatutory = round2(
			statutory.reduce((total, row) => total + row.employee_amount, 0)
		);
		const employerStatutory = round2(
			statutory.reduce((total, row) => total + row.employer_amount, 0)
		);
		const total_deductions = round2(employeeStatutory + netSubtract);
		const net = round2(gross - total_deductions + netAdd);
		if (net < 0)
			return yield* Effect.fail(
				new Refusal({ message: `${who}: net pay would be negative (${net}).` })
			);
		// The payslip validations read the slip as built: `payslip` (its totals and lines by code) and `statutory`.
		const lines: { [code: string]: number } = {};
		for (const line of [...base, ...adjustments])
			lines[line.component_code] = round2((lines[line.component_code] ?? 0) + line.amount);
		let hold: string | null = null;
		for (const check of yield* tripped(options.validations, {
			...context,
			payslip: {
				gross,
				net,
				total_deductions,
				statutory_employee: employeeStatutory,
				statutory_employer: employerStatutory,
				net_additions: round2(netAdd),
				net_deductions: round2(netSubtract),
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
			employer_cost: round2(gross + netAdd + employerStatutory),
			proration,
			service_basis: salaryRun
				? [{ from: employedFrom, to: employedTo, days: paidDays, denominator: monthDays }]
				: [],
			pins,
			warnings,
			hold
		};
	});

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
}): Effect.Effect<{ lines: PayslipStatutoryLine[]; warnings: string[] }, Refusal> =>
	Effect.gen(function* () {
		const warnings: string[] = [];
		const { subject, period } = input;
		const month = input.window.from.slice(0, 7);
		const inYear = input.history.filter(
			(slip) => slipPeriod(slip).startsWith(month.slice(0, 4)) && slipPeriod(slip) <= month
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
			employee: round2(list.reduce((sum, line) => sum + num(line.employee_amount), 0)),
			employer: round2(list.reduce((sum, line) => sum + num(line.employer_amount), 0))
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
		for (const row of input.statutoryRows.toSorted((left, right) =>
			left.code.localeCompare(right.code)
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
		const charged = {
			year: Object.fromEntries(codes.map((code) => [code, amounts(lines(before, code))])),
			month: Object.fromEntries(codes.map((code) => [code, amounts(lines(monthPrior, code))]))
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
			if ([...paid.values()].every((amount) => amount === 0) && monthLines.length === 0) continue;
			const prior = partSums(monthLines, parts);
			const wage = Object.fromEntries([...parts].map((part) => [part, paid.get(part) ?? 0]));
			const monthToDate = Object.fromEntries(
				[...parts].map((part) => [part, (prior[part] ?? 0) + (wage[part] ?? 0)])
			);
			let context: DynObject = {
				...subject,
				...input.roots,
				headcount: isDynObject(subject.company) ? (subject.company.headcount ?? 0) : 0,
				wage,
				month: monthToDate,
				year: partSums(lines(before, row.code), parts),
				period: periodFacts,
				rules: input.rules,
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
				person: { ...(isDynObject(subject.person) ? subject.person : {}), ...personFacts }
			};
			// Each part's month-to-date assessable amount: the scheme's expression, or the part as paid; never below zero.
			const monthAssessed: { [part: string]: number } = {};
			for (const part of parts) {
				const expression = configuration.assessable?.[part];
				const value =
					expression == null
						? (monthToDate[part] ?? 0)
						: yield* evaluateNumber(expression, context, `${where} assessable.${part}`);
				monthAssessed[part] = round2(Math.max(0, value));
			}
			const total = round2(Object.values(monthAssessed).reduce((sum, value) => sum + value, 0));
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
				break;
			}
			// A scheme the month paid wages toward keeps its line even when nothing is charged: a later slip of the month
			// reads the month's earlier wage from these parts.
			const month = charge ?? { employee: 0, employer: 0 };
			const slipParts = Object.fromEntries(
				[...parts].map((part) => [part, round2((monthAssessed[part] ?? 0) - (prior[part] ?? 0))])
			);
			assessed.push({
				scheme_code: row.code,
				base_amount: round2(Object.values(slipParts).reduce((sum, value) => sum + value, 0)),
				parts: slipParts,
				employee_amount: round2(
					month.employee - monthLines.reduce((sum, line) => sum + num(line.employee_amount), 0)
				),
				employer_amount: round2(
					month.employer - monthLines.reduce((sum, line) => sum + num(line.employer_amount), 0)
				),
				...(appliedWhen == null ? {} : { rule_when: appliedWhen })
			});
			const line = assessed.at(-1)!;
			const sofar = charged.month[row.code] ?? { employee: 0, employer: 0 };
			charged.month[row.code] = {
				employee: round2(sofar.employee + line.employee_amount),
				employer: round2(sofar.employer + line.employer_amount)
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
	const read = workspaceReadAsHost(ctx.db.read);
	const out: R[] = [];
	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	for (const [i, input] of inputs.entries()) {
		const stored = entryRow(ctx.existing[i]);
		if (stored.payslip_id != null) {
			if ('$delete' in input || !pinOnly(input))
				ctx.refuse('This entry is settled on a payslip. Delete that payroll run to change it.');
			out.push(input);
			continue;
		}
		if ('$delete' in input || pinOnly(input)) {
			out.push(input);
			continue;
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
				values: merged
			}),
			read,
			ctx.refuse
		);
		if (collection === 'leave_catalog_entry' && isLeaveAdmitted(collection, admitted)) {
			const [contractPage, catalogPage, movementPage] = await Promise.all([
				read('employment_contract', {
					where: { id: { eq: String(merged.employment_id ?? '') } },
					select: { effective_range: true, prior_service_months: true },
					limit: 1
				}),
				read('leave_catalog', {
					where: { id: { eq: admitted.catalog_id } },
					select: {
						id: true,
						code: true,
						name: true,
						can_encash: true,
						is_npl: true,
						consumes_code: true,
						entitlement: true,
						settings_id: true
					},
					limit: 1
				}),
				read('leave_catalog_entry', {
					where: { employment_id: { eq: String(merged.employment_id ?? '') } },
					select: {
						catalog_id: true,
						employment_id: true,
						activity: true,
						occurred_on: true,
						approval_id: true,
						days: true,
						from: true,
						to: true,
						facts: true
					},
					all: true
				})
			]);
			const contract = contractPage.rows[0];
			const catalog = catalogPage.rows[0];
			const siblings =
				catalog?.settings_id == null
					? catalogPage
					: await read('leave_catalog', {
							where: { settings_id: { eq: catalog.settings_id } },
							select: {
								id: true,
								code: true,
								name: true,
								can_encash: true,
								is_npl: true,
								consumes_code: true,
								entitlement: true
							},
							all: true
						});
			const asOf = dayKey(merged.from) ?? dayKey(merged.occurred_on) ?? '';
			const subject = await runEngine(
				leaveSubject(String(merged.employment_id ?? ''), asOf),
				read,
				ctx.refuse
			);
			const message = refuseLeaveWrite({
				context: { ...subject.context, entry: entryContext(merged, asOf) },
				employmentStart: subject.employmentStart,
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
				classes: siblings.rows.map(classFromRow),
				movements: movementPage.rows.map(movementFromRow),
				serviceMonths: serviceMonthsAt(
					dayKey(contract?.effective_range),
					asOf,
					contract?.prior_service_months
				)
			});
			if (message != null) ctx.refuse(message);
		}
		out.push({ ...input, company_id: admitted.company_id, catalog_id: admitted.catalog_id });
	}
	return out;
};
