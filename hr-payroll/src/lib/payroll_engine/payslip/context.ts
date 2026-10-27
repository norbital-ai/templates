import { Predicate } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Result, Schema } from 'effect';
import { type SuspensionKind } from '../suspension_kinds.js';
import { fromAbsolute, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
import {
	addDays,
	addMonths,
	datePeriod,
	days,
	eachDay,
	Instant,
	monthOf,
	PlainDate
} from '@norbital-ai/std/date';
import { evaluateConfigured } from '../expressions.js';
import { isMasked, type Id, type Masked, type Row } from '@norbital-ai/bolt';
import {
	type DynObject,
	type Json,
	type JsonObject,
	completedMonths,
	fieldValue,
	Reads,
	type Read,
	numberOf,
	Refusal
} from '../foundation.js';
import {
	type AttendanceDay,
	classFromRow,
	coverageRange,
	movementFromRow,
	movementsByCode,
	readsAttendance,
	serviceMonthsAt
} from '../leave.js';
import {
	roundHours,
	type PlannedShift,
	plannedShift,
	plannedShiftId,
	type ShiftPattern,
	type ShiftVariant
} from '../shift_pattern.js';
import {
	SETTINGS,
	ENTITY,
	CONTRACT,
	PROFILE,
	HISTORY,
	ENTRY,
	LEAVE_CLASS,
	ROSTER,
	HOLIDAY,
	CATALOG,
	STATUTORY
} from '../rows.js';
import { type SettlementPeriod } from '../frequency.js';
import type { Validation } from '../admit.js';
export const round2 = (value: number): number => Math.round(value * 100 + Number.EPSILON) / 100;
/** A currency's minor units (ISO 4217 exponent, as the runtime's currency data holds it): JPY 0, SGD 2. */
export const currencyScale = (currency: string): number => {
	return Result.getOrElse(
		Result.try(
			() =>
				new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
					.maximumFractionDigits ?? 2
		),
		() => 2
	);
};
/** The first month (`YYYY-MM`) of the year holding `month`, for a year starting in `startMonth` (1–12). */
export const taxYearStart = (month: string, startMonth = 1): string => {
	const start = Math.min(12, Math.max(1, Math.trunc(startMonth)));
	const year = Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < start ? 1 : 0);
	return `${year}-${String(start).padStart(2, '0')}`;
};
/** The zone an entity's days and clocks are counted in: its own, else its version's `payroll.timezone`. */
export const zoneOf = (
	entity: Pick<EntityRow, 'time_zone'>,
	version: Pick<SettingsRow, 'payroll'> | undefined
) =>
	Result.gen(function* () {
		const zone = yield* fieldValue(entity.time_zone, 'entity.time_zone');
		if (zone != null) return zone;
		const payroll = yield* fieldValue(version?.payroll, 'jurisdiction_settings.payroll');
		if (payroll?.timezone == null || payroll.timezone === '')
			return yield* Result.fail(
				new Refusal({
					message:
						'The entity states no time zone and its jurisdiction version names no payroll.timezone.'
				})
			);
		return payroll.timezone;
	});
/** Half-up rounding to `scale` decimals: the money of one payroll currency. */
export const roundTo =
	(scale: number) =>
	(value: number): number => {
		const unit = 10 ** scale;
		return Math.round(value * unit + Number.EPSILON) / unit;
	};
export const num = (value: unknown, fallback = 0): number => numberOf(value) ?? fallback;
// ponytail: `earned.history` reads 24 months back (a benefit averaged over the 12–18 months before a contingency);
// rows pick their months from it. A longer look-back needs a larger read.
export const LONG_HISTORY_MONTHS = 24;
/** A version's required month window (`payroll.history_months`, `payroll.rolling_hours_months`); refuses when absent. */
export const payrollMonths = (
	version: Pick<SettingsRow, 'code' | 'payroll'> | undefined,
	key: 'history_months' | 'rolling_hours_months'
) =>
	Result.gen(function* () {
		const payroll = yield* fieldValue(version?.payroll, 'jurisdiction_settings.payroll');
		const months = payroll?.[key];
		if (months == null)
			return yield* Result.fail(
				new Refusal({
					message: `jurisdiction_settings ${version?.code ?? ''} needs payroll.${key}: the months it reads.`
				})
			);
		return months;
	});
export const dayInRange = (day: string, range: CalendarRange): boolean =>
	(range.from == null || day >= range.from) && (range.to == null || day <= range.to);

/** Active employee contracts on a day, preserving failures for masked fields. */
export const inForce = (
	contracts: readonly Pick<ContractRow, 'effective_range' | 'engagement'>[],
	day: string
) =>
	Result.gen(function* () {
		let count = 0;
		for (const contract of contracts) {
			const engagement = yield* fieldValue(contract.engagement, 'employment_contract.engagement');
			const range = yield* fieldValue(
				contract.effective_range,
				'employment_contract.effective_range'
			);
			if (engagement !== 'PAYEE' && dayInRange(day, range)) count++;
		}
		return count;
	});
export type PayrollRunKind = 'REGULAR' | 'OFF_CYCLE';
/** Salary runs pay the contract; settlement runs pay only their selected entries. */
export const SALARY_RUNS: readonly PayrollRunKind[] = ['REGULAR'];
export const isSalaryRun = (kind: unknown): boolean =>
	SALARY_RUNS.some((allowed) => allowed === kind);
export type PayrollRunRequest = {
	readonly company_id: Id<'entity'>;
	readonly period: string;
	readonly kind: PayrollRunKind;
	readonly sources?: readonly string[];
	readonly pay_due_date?: string;
	/** The run being built, when it is already stored: it is not its own duplicate. */
	readonly run_id?: string;
};
/** The entry and roster models a payslip consumes; the run pins each consumed row to its payslip. */
export type PinnedCollection =
	| 'adhoc_catalog_entry'
	| 'claim_catalog_entry'
	| 'leave_catalog_entry'
	| 'loan_repayment_entry'
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
	readonly company_payments: readonly {
		readonly family: string;
		readonly source_id: string;
		readonly component_code: string;
		readonly amount: number;
		readonly label?: string;
	}[];
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
	readonly pins: readonly {
		readonly collection: PinnedCollection;
		readonly id: string;
	}[];
	/** What the records flagged on this slip (`warn`, `warn_when`), each named by the person. */
	readonly warnings: readonly string[];
	/** Why a `hold` validation stops this slip: the run's `pin`-time behaviour puts it ON_HOLD. */
	readonly hold: string | null;
};
export type PayrollPlan = {
	readonly run: {
		readonly company_id: Id<'entity'>;
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
interface CalendarRange {
	readonly from?: string | null;
	readonly to?: string | null;
}
/** One scheme's stored configuration: CEL over the month's assessed wage. */
export type StatutoryRow = Pick<
	Row<'statutory_contribution_catalog'>,
	'id' | 'code' | 'configuration'
>;
export type StatutoryConfiguration = StatutoryRow['configuration'];
export type SettingsRow = Pick<
	Row<'jurisdiction_settings'>,
	| 'id'
	| 'code'
	| 'payroll'
	| 'behaviours'
	| 'suspension_kinds'
	| 'effective_range'
	| 'sealed_at'
	| 'voided_at'
> & {
	readonly rule_set?: readonly Pick<
		Row<'rule_set'>,
		'id' | 'code' | 'family' | 'rules' | 'settings_id'
	>[];
};
export type EntityRow = Pick<
	Row<'entity'>,
	| 'id'
	| 'name'
	| 'settings_code'
	| 'pay_cutoff_day'
	| 'pay_frequency'
	| 'pay_frequency_changes'
	| 'region'
	| 'risk_class'
	| 'time_zone'
	| 'facts'
	| 'validation_severity'
>;
/** A catalogue row the engine prices a line from: its class, its sign and the schemes it counts toward. */
export interface CatalogRow {
	readonly id: string;
	readonly code: string;
	readonly name?: string | null;
	readonly destination?: 'PAY' | 'NET' | 'EMPLOYER' | 'DISPLAY';
	readonly direction?: 'ADD' | 'SUBTRACT' | null;
	readonly counts_toward?: readonly string[];
	readonly eligibility?: string | null;
	readonly qualifies_when?: string | null;
	readonly bands?: readonly {
		readonly when?: string;
		readonly amount: string;
		readonly limit?: {
			readonly amount?: string | null;
			readonly on_exceed?: string;
			/** The span the limit meters: `ENTRY` (default, each claim alone), `PERIOD` (the run's settlement period) or
			 * `CALENDAR_YEAR`, less the claims of the class already taken in it. */
			readonly window?: string | null;
		} | null;
	}[];
	readonly is_npl?: boolean;
	readonly can_encash?: boolean;
	readonly component_code?: string | null;
	readonly quantity?: string | null;
	readonly rate?: string | null;
	readonly amount?: string | null;
	readonly prorated?: boolean;
	readonly pay_fraction?: string | null;
	/** An ad hoc class whose entries may fall after the employment ends (`adhoc_catalog.payable_after_exit`). */
	readonly payable_after_exit?: boolean;
	/** An ad hoc class the final slip raises itself when its eligibility holds (`adhoc_catalog.raise_on_exit`). */
	readonly raise_on_exit?: boolean;
	/** A leave class's share of a row across periods: `WORKING_DAYS` (default) or `CALENDAR_DAYS`. */
	readonly share_by?: string;
	/** A prorated work line's stated divisor (CEL; default the period's calendar days). */
	readonly denominator?: string | null;
	/** Whether an entry of the class must carry an amount (default true): a band-priced class need not. */
	readonly amount_required?: boolean;
}
export type ContractTerm = NonNullable<
	Exclude<ContractRow['facts'], Masked>['contract_terms']
>[number];
export type ContractRow = Pick<
	Row<'employment_contract'>,
	| 'id'
	| 'employee_id'
	| 'company_id'
	| 'effective_range'
	| 'prior_service_months'
	| 'engagement'
	| 'exit_ground'
	| 'exit_facts'
	| 'facts'
>;
export type EmployeeRow = Pick<
	Row<'employment_profile'>,
	| 'id'
	| 'name'
	| 'date_of_birth'
	| 'nationality'
	| 'gender'
	| 'marital_status'
	| 'children'
	| 'facts'
>;
/** An entry family's own columns; `facts` is the one open bag, merged last into the rule context. */
export interface EntryColumns {
	readonly amount?: unknown;
	readonly quantity?: Decimal | number | null | undefined;
	readonly days?: Decimal | number | null | undefined;
	readonly from?: string | null | undefined;
	readonly to?: string | null | undefined;
	readonly incurred_on?: string | null | undefined;
	readonly due_on?: string | null | undefined;
	readonly label?: string | null | undefined;
	readonly reference?: string | null | undefined;
	readonly facts?: JsonObject | null | undefined;
}
type NativeEntryRow =
	| Row<'adhoc_catalog_entry'>
	| Row<'claim_catalog_entry'>
	| Row<'leave_catalog_entry'>
	| Row<'loan_repayment_entry'>;
export type EntryRow = EntryColumns &
	Pick<NativeEntryRow, 'id'> &
	Partial<
		Pick<NativeEntryRow, 'catalog_id' | 'employment_id' | 'occurred_on' | 'activity' | 'payslip_id'>
	>;
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
	facts: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Json))),
	payslip_id: Schema.optional(Schema.NullOr(Schema.String))
});
export type LooseEntryRow = Schema.Schema.Type<typeof LooseEntryRowSchema>;
/** A transform's stored row carries its decimal columns as `Decimal`s: they are read as numbers. */
export const entryRow = (value: unknown): LooseEntryRow => {
	if (value == null) return {};
	const held = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value);
	const number = (key: 'days' | 'quantity') =>
		held[key] == null ? {} : { [key]: numberOf(held[key]) };
	return Schema.decodeUnknownSync(LooseEntryRowSchema)({
		...held,
		...number('days'),
		...number('quantity')
	});
};
const ENTRY_COLUMNS = ['quantity', 'days', 'from', 'to', 'incurred_on', 'due_on', 'label'] as const;
/** An entry's own columns as the CEL `entry` context: the family's columns, then its open `facts`, then the defaults. */
export const entryContext = (row: EntryColumns, occurred_on: string): DynObject => {
	const typed: {
		[key: string]: Json;
	} = {};
	for (const key of ENTRY_COLUMNS) {
		const value = row[key];
		if (value != null) typed[key] = value instanceof Decimal ? value.toNumber() : value;
	}
	const facts = row.facts ?? {};
	return {
		...typed,
		...facts,
		amount: numberOf(row.amount) ?? 0,
		quantity: num(row.quantity, 1),
		occurred_on,
		due_on: row.due_on ?? occurred_on,
		incurred_on: row.incurred_on ?? occurred_on,
		facts
	};
};
/** An entry row as an earlier sibling of the one being priced: its class code beside its own columns. */
export type EarlierRow = EntryRow & {
	readonly code: string;
};
/**
 * The CEL root `earlier`: the employment's entries of the same class code before this one (by day, then id) — `rows`
 * (each its columns and open facts), and the signed amounts of the calendar year and of the employment. A class caps
 * per key (a child, an event) by filtering `rows` on its facts.
 */
export const earlierContext = (
	siblings: readonly EarlierRow[],
	entry: {
		readonly id?: string;
		readonly code: string;
		readonly occurred_on: string;
	}
) => {
	const before = siblings.filter(
		(row) =>
			row.code === entry.code &&
			row.id !== entry.id &&
			(String(row.occurred_on ?? '') < entry.occurred_on ||
				(String(row.occurred_on ?? '') === entry.occurred_on && row.id < String(entry.id ?? '')))
	);
	const signed = (row: EarlierRow) =>
		(row.activity === 'REVERSAL' ? -1 : 1) * (numberOf(row.amount) ?? 0);
	const sum = (rows: readonly EarlierRow[]) =>
		round2(rows.reduce((total, row) => total + signed(row), 0));
	return {
		rows: before.map((row): JsonObject => {
			const facts = row.facts ?? {};
			return {
				...facts,
				facts,
				id: row.id,
				code: row.code,
				activity: row.activity ?? '',
				amount: numberOf(row.amount) ?? 0,
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
export const earlierSum = (rows: readonly JsonObject[], from: string, to: string): number =>
	round2(
		rows
			.filter((row) => String(row['occurred_on']) >= from && String(row['occurred_on']) <= to)
			.reduce(
				(total, row) => total + (row['activity'] === 'REVERSAL' ? -1 : 1) * num(row['amount']),
				0
			)
	);
type RosterRow = Pick<
	Row<'roster_entry'>,
	| 'id'
	| 'employment_id'
	| 'work_date'
	| 'shift_definition_id'
	| 'planned_overtime_hours'
	| 'approved_overtime_intervals'
	| 'worked_intervals'
	| 'banked_overtime_hours'
	| 'banked_overtime_band'
	| 'overtime_consented_at'
	| 'worksite'
	| 'facts'
	| 'payslip_id'
>;
/** Attendance facts accepted by the planner from either decoded rows or the reviewed numeric draft. */
export type RosterInput = Partial<
	Pick<
		RosterRow,
		| 'worked_intervals'
		| 'approved_overtime_intervals'
		| 'banked_overtime_band'
		| 'overtime_consented_at'
		| 'worksite'
		| 'facts'
		| 'shift_definition_id'
	>
> & {
	readonly banked_overtime_hours?: RosterRow['banked_overtime_hours'] | number;
	readonly planned_overtime_hours?: RosterRow['planned_overtime_hours'] | number;
};
/** A work suspension: an entity's blocked-out days of one kind, for a worksite or named employments (else all). */
interface SuspensionRow {
	readonly kind: string;
	readonly starts_on: string;
	readonly ends_on: string;
	readonly worksite?: string | null;
	readonly employment_ids?: readonly string[] | null;
	readonly facts?: JsonObject | null;
}
/** The suspension covering one employment's day: it names the employment, or names none and its worksite (if any)
 * is the day's (the roster's worksite, else the terms' `facts.worksite`). */
export const suspensionOn = (
	suspensions: readonly SuspensionRow[],
	employment_id: string,
	date: string,
	worksite: string
): SuspensionRow | undefined =>
	suspensions.find((held) => {
		if (date < held.starts_on || date > held.ends_on) return false;
		const named = held.employment_ids ?? [];
		if (named.length > 0) return named.includes(employment_id);
		return held.worksite == null || held.worksite === '' || held.worksite === worksite;
	});
/** A version's inline suspension kinds by code. */
export const suspensionKinds = (settings_id: Id<'jurisdiction_settings'>) =>
	Effect.gen(function* () {
		const { read } = yield* Reads;
		const { jurisdiction_settings } = yield* read({
			jurisdiction_settings: {
				where: { id: { eq: settings_id } },
				fields: ['suspension_kinds'],
				limit: 1
			}
		});
		const kinds = yield* Effect.fromResult(
			fieldValue(
				jurisdiction_settings.rows[0]?.suspension_kinds,
				'jurisdiction_settings.suspension_kinds'
			)
		);
		return new Map((kinds ?? []).map((kind) => [kind.code, kind]));
	});
/** One stored CEL flag of a suspension kind; a kind that leaves it blank is refused. */
const kindFlag = (
	kind: SuspensionKind | undefined,
	flag: 'counts_as_attended' | 'scheduled',
	context: DynObject
) => {
	const expression = kind?.[flag];
	const where = `suspension_kind ${kind?.code ?? ''}`;
	return expression == null || expression.trim() === ''
		? Effect.fail(
				new Refusal({ message: `${where} needs ${flag}: the CEL deciding a suspended day.` })
			)
		: evaluateBoolean(expression, context, where);
};
/** A suspended day's attendance effects under its kind: whether it counts as attended and stays scheduled. */
export const suspendedDay = (kind: SuspensionKind | undefined, context: DynObject) =>
	Effect.gen(function* () {
		return {
			counts_as_attended: yield* kindFlag(kind, 'counts_as_attended', context),
			scheduled: yield* kindFlag(kind, 'scheduled', context)
		};
	});
/** The worksite of a day: the roster's, else the terms in force's `facts.worksite`. */
export const worksiteOn = (row: RosterInput | undefined, term: ContractTerm | undefined) =>
	Result.gen(function* () {
		const worksite = yield* fieldValue(row?.worksite, 'roster_entry.worksite');
		const fact = term?.facts?.['worksite'];
		return worksite ?? (Predicate.isString(fact) ? fact : '');
	});
export interface ShiftDefinitionRow {
	readonly id: string;
	readonly code?: string;
	readonly variant?: ShiftVariant;
}
export interface ShiftPatternRow {
	readonly id: string;
	readonly pattern?: ShiftPattern;
	readonly effective_range?: CalendarRange | null;
}
/** A leave movement as the payslip reads its absence event: the event key and the day it covers from. */
export type LeaveEventRow = Pick<
	EntryRow,
	'id' | 'days' | 'catalog_id' | 'employment_id' | 'from' | 'to' | 'occurred_on' | 'facts'
>;
export interface HolidayRow {
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
	readonly parts: {
		readonly [part: string]: number;
	};
	/** The wage this slip paid toward the scheme, per part, before `assessable`: a later slip's month starts from it. */
	readonly wages?: {
		readonly [part: string]: number;
	};
	readonly employee_amount: number;
	readonly employer_amount: number;
	/** The base the applied rule charged on (`configuration.assessment`, else the assessed parts), month to date. */
	readonly charged_base?: number;
	readonly rule_when?: string;
};
export type PayslipRow = Pick<
	Row<'payslip'>,
	| 'id'
	| 'payroll_run_id'
	| 'employment_id'
	| 'status'
	| 'proration'
	| 'salary_from'
	| 'statutory'
	| 'base'
	| 'adjustments'
	| 'gross'
	| 'net'
>;
/** What each read selects: a caller's list read without `select` leaves json, custom and file fields out (Bolt X-33),
 * so every engine read names its fields. */
export const payrollRules = (
	version:
		| {
				readonly rule_set?: readonly {
					readonly family: string;
					readonly code: string;
					readonly rules: Json;
				}[];
		  }
		| null
		| undefined
): {
	readonly [code: string]: Json;
} =>
	Object.fromEntries(
		(version?.rule_set ?? []).flatMap((row): [string, Json][] =>
			row.family === 'PAYROLL' ? [[row.code, row.rules ?? {}]] : []
		)
	);
export const FAMILIES = [
	{ collection: 'adhoc_catalog_entry', catalog: 'adhoc_catalog', family: 'ADHOC' },
	{ collection: 'claim_catalog_entry', catalog: 'claim_catalog', family: 'CLAIM' },
	{ collection: 'leave_catalog_entry', catalog: 'leave_catalog', family: 'LEAVE' },
	{ collection: 'loan_repayment_entry', catalog: 'loan_catalog', family: 'LOAN_REPAYMENT' }
] as const;
/**
 * The catalogue layers a payroll build prices from, read under a `jurisdiction_settings` root: each version row comes
 * with its `statutory_contribution_catalog`, `work_catalog`, … and `rule_set` rows. Spread beside the root.
 */
export const GOVERNED = {
	'jurisdiction_settings.statutory_contribution_catalog': { fields: STATUTORY },
	'jurisdiction_settings.work_catalog': { fields: CATALOG.work_catalog },
	'jurisdiction_settings.allowance_catalog': { fields: CATALOG.allowance_catalog },
	'jurisdiction_settings.adhoc_catalog': { fields: CATALOG.adhoc_catalog },
	'jurisdiction_settings.claim_catalog': { fields: CATALOG.claim_catalog },
	'jurisdiction_settings.leave_catalog': { fields: CATALOG.leave_catalog },
	'jurisdiction_settings.loan_catalog': { fields: CATALOG.loan_catalog },
	'jurisdiction_settings.rule_set': { fields: ['code', 'family', 'rules', 'settings_id'] }
} as const;
/** The versions `ids` with every catalogue row a payroll build prices from: one read. */
export const loadGoverned = Effect.fnUntraced(function* (
	read: Read,
	ids: readonly Id<'jurisdiction_settings'>[]
) {
	const { jurisdiction_settings } = yield* read({
		jurisdiction_settings: { where: { id: { in: ids } }, fields: ['suspension_kinds'] },
		...GOVERNED
	});
	return jurisdiction_settings.rows;
});
export type GovernedVersion = Effect.Success<ReturnType<typeof loadGoverned>>[number];
/** One version of a governance read, with its catalogue layers. */
export const governedFrom = <V extends { readonly id: string }>(
	versions: readonly V[],
	settings_id: Id<'jurisdiction_settings'>
): V | undefined => versions.find((row) => row.id === settings_id);
/** The distinct ids a column of one wave holds: the next wave's literal `{ in: [...] }`. */
export const idsOf = <T extends string>(
	values: readonly (T | Masked | null | undefined)[]
): T[] => [...new Set(values.filter((value): value is T => value != null && !isMasked(value)))];
type EntryFamily = (typeof FAMILIES)[number];
export type EntryCollection = EntryFamily['collection'];
export type CatalogName<C extends EntryCollection> = Extract<
	EntryFamily,
	{
		collection: C;
	}
>['catalog'];
export type EntryCatalogueId = {
	readonly [C in EntryCollection]: Id<CatalogName<C>>;
}[EntryCollection];
type LeaveAdmitted = {
	readonly company_id: Id<'entity'>;
	readonly catalog_id: Id<'leave_catalog'>;
	readonly version: SettingsRow;
};
export const isLeaveAdmitted = (
	collection: EntryCollection,
	admitted: {
		readonly company_id: Id<'entity'>;
		readonly catalog_id: EntryCatalogueId;
		readonly version: SettingsRow;
	}
): admitted is LeaveAdmitted => collection === 'leave_catalog_entry';
export const termFor = (contract: Partial<Pick<ContractRow, 'facts'>>, day: string) =>
	Result.gen(function* () {
		const facts = yield* fieldValue(contract.facts, 'employment_contract.facts');
		return (facts?.contract_terms ?? [])
			.filter((term) => term.effective_range != null && dayInRange(day, term.effective_range))
			.sort((left, right) =>
				String(left.effective_range?.from).localeCompare(String(right.effective_range?.from))
			)
			.at(-1);
	});
export const moneyValue = (value: unknown): number => numberOf(value) ?? 0;
/** How many settlement periods a pay frequency cuts a calendar month into. */
export const evaluate = (
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
export const evaluateNumber = (expression: string, context: DynObject, where: string) =>
	evaluate(expression, context, where).pipe(
		Effect.flatMap((value) =>
			Schema.is(Schema.Number)(value) && Number.isFinite(value)
				? Effect.succeed(value)
				: Effect.fail(
						new Refusal({ message: `${where}: the stored expression must return a number.` })
					)
		)
	);
export const evaluateBoolean = (
	expression: string | null | undefined,
	context: DynObject,
	where: string
) =>
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
/** The zone an entity counts `day` in: its own, else the `payroll.timezone` of its lineage's version governing the day
 * among `versions` (any lineage's rows; the entity's are picked by its code), else the workspace's. */
export const zoneOn = (
	entity: Pick<EntityRow, 'time_zone' | 'settings_code'>,
	versions: readonly Pick<
		SettingsRow,
		'id' | 'code' | 'payroll' | 'effective_range' | 'sealed_at' | 'voided_at'
	>[],
	day: string
) =>
	zoneOf(
		entity,
		Result.getOrUndefined(
			versionOn(
				versions.filter((row) => row.code === entity.settings_code),
				entity.settings_code,
				day
			)
		)
	);
export const versionOn = <
	Version extends Pick<SettingsRow, 'id' | 'effective_range' | 'sealed_at' | 'voided_at'>
>(
	versions: readonly Version[],
	settings_code: string | null | undefined,
	day: string
): Result.Result<Version, Refusal> => {
	const version = versions
		.filter(
			(row) =>
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
		? Result.fail(
				new Refusal({ message: `No sealed ${settings_code} jurisdiction version governs ${day}.` })
			)
		: Result.succeed(version);
};
export const governingVersion = Effect.fnUntraced(function* (
	entity: Pick<EntityRow, 'settings_code'>,
	day: string
) {
	const { read } = yield* Reads;
	const { jurisdiction_settings } = yield* read({
		jurisdiction_settings: {
			where: {
				code: { eq: entity.settings_code },
				voided_at: { isNull: true },
				sealed_at: { isNull: false }
			},
			fields: SETTINGS
		},
		'jurisdiction_settings.rule_set': {
			where: { family: { eq: 'PAYROLL' } },
			fields: ['code', 'family', 'rules', 'settings_id']
		}
	});
	return yield* Effect.fromResult(versionOn(jurisdiction_settings.rows, entity.settings_code, day));
});
export const entityOf = (company_id: Id<'entity'>) =>
	Effect.gen(function* () {
		const { read } = yield* Reads;
		const { entity } = yield* read({
			entity: { where: { id: { eq: company_id } }, fields: ENTITY, limit: 1 }
		});
		const found = entity.rows[0];
		if (found == null)
			return yield* new Refusal({ message: 'This needs an actual approved legal entity.' });
		return found;
	});
/**
 * The leave subjects `ids` as three dependent reads: the employments; their people, companies, the companies'
 * staffing, payslips and leave movements; then the payslips' runs and the movements' classes.
 */
const subjectWaves = Effect.fnUntraced(function* (
	read: Read,
	ids: readonly Id<'employment_contract'>[]
) {
	const first = yield* read({
		employment_contract: { where: { id: { in: ids } }, fields: CONTRACT }
	});
	const employment = first.employment_contract;
	const second = yield* read({
		employment_profile: {
			where: { id: { in: idsOf(employment.rows.map((row) => row.employee_id)) } },
			fields: PROFILE
		},
		entity: {
			where: { id: { in: idsOf(employment.rows.map((row) => row.company_id)) } },
			fields: ENTITY
		},
		employment_contract: {
			where: { company_id: { in: idsOf(employment.rows.map((row) => row.company_id)) } },
			fields: ['effective_range', 'engagement', 'company_id']
		},
		payslip: { where: { employment_id: { in: ids } }, fields: HISTORY },
		leave_catalog_entry: {
			where: { employment_id: { in: ids } },
			fields: ENTRY.leave_catalog_entry
		}
	});
	return { employment, second };
});
const subjectsOf = <P, L>(
	{ employment, second }: Effect.Success<ReturnType<typeof subjectWaves>>,
	third: { readonly payroll_run: P; readonly leave_catalog: L }
) => ({
	employment,
	people: second.employment_profile,
	companies: second.entity,
	staffing: second.employment_contract,
	payslips: second.payslip,
	runs: third.payroll_run,
	entries: second.leave_catalog_entry,
	catalogues: third.leave_catalog
});
/** The third wave of a subject read: the payslips' runs and the movements' classes. */
const subjectClassesOf = (waves: Effect.Success<ReturnType<typeof subjectWaves>>) =>
	({
		payroll_run: {
			where: { id: { in: idsOf(waves.second.payslip.rows.map((row) => row.payroll_run_id)) } },
			fields: ['kind']
		},
		leave_catalog: {
			where: {
				id: { in: idsOf(waves.second.leave_catalog_entry.rows.map((row) => row.catalog_id)) }
			},
			fields: ['code']
		}
	}) as const;
export const loadSubjects = Effect.fnUntraced(function* (
	read: Read,
	ids: readonly Id<'employment_contract'>[]
) {
	const waves = yield* subjectWaves(read, ids);
	return subjectsOf(waves, yield* read(subjectClassesOf(waves)));
});
type SubjectRead = Effect.Success<ReturnType<typeof loadSubjects>>;
export type Employment = ContractRow & {
	readonly person: EmployeeRow | null;
	readonly company:
		(EntityRow & { readonly employment_contract: SubjectRead['staffing']['rows'] }) | null;
	readonly payslip: readonly (PayslipRow & {
		readonly run: SubjectRead['runs']['rows'][number] | null;
	})[];
	readonly leave_catalog_entry: readonly (SubjectRead['entries']['rows'][number] & {
		readonly catalog: SubjectRead['catalogues']['rows'][number] | null;
	})[];
};
export function employmentFrom(
	got: SubjectRead,
	employment_id: Id<'employment_contract'>
): Employment | undefined {
	const contract = got.employment.rows.find((row) => row.id === employment_id);
	if (contract === undefined) return undefined;
	const company = got.companies.rows.find((row) => row.id === contract.company_id);
	return {
		...contract,
		person: got.people.rows.find((row) => row.id === contract.employee_id) ?? null,
		company:
			company === undefined
				? null
				: {
						...company,
						employment_contract: got.staffing.rows.filter((row) => row.company_id === company.id)
					},
		payslip: got.payslips.rows
			.filter((row) => row.employment_id === contract.id)
			.map((row) => ({
				...row,
				run: got.runs.rows.find((run) => run.id === row.payroll_run_id) ?? null
			})),
		leave_catalog_entry: got.entries.rows
			.filter((row) => row.employment_id === contract.id)
			.map((row) => ({
				...row,
				catalog: got.catalogues.rows.find((catalog) => catalog.id === row.catalog_id) ?? null
			}))
	};
}
const employmentOf = (employment_id: Id<'employment_contract'>) =>
	Effect.gen(function* () {
		const { read } = yield* Reads;
		return employmentFrom(yield* loadSubjects(read, [employment_id]), employment_id);
	});
/** What a leave subject reads beside the employment: its payslips, each with its run's kind. */
export const companyOf = (
	held: Employment
): Effect.Effect<NonNullable<Employment['company']>, Refusal> =>
	held.company == null
		? Effect.fail(new Refusal({ message: 'This needs an actual approved legal entity.' }))
		: Effect.succeed(held.company);
/**
 * Admit one payroll run request: its entity, the version governing its period, the behaviour that admits its kind,
 * no second salary run for the period, and — for a settlement run — only approved, unpaid ad hoc or claim entries.
 * The run model's transform and the run build both admit through here.
 */
export const subjectContext = (input: {
	readonly contract: Partial<
		Pick<
			ContractRow,
			'effective_range' | 'exit_ground' | 'exit_facts' | 'engagement' | 'prior_service_months'
		>
	>;
	readonly employee: EmployeeRow | undefined;
	readonly entity: EntityRow | undefined;
	readonly term: ContractTerm | undefined;
	readonly day: string;
	/** The entity's contracts in force on the day. */
	readonly headcount: number;
	/** The governing version: its `payroll.monthly_wage` CEL defines `terms.monthly_wage`. */
	readonly version?: SettingsRow | undefined;
	/** Captured allowance identities resolved once by the caller, including earlier snapshot assignments. */
	readonly allowanceCodes?: ReadonlyMap<string, string>;
}) =>
	Result.gen(function* () {
		const { term, day } = input;
		const contract = {
			...input.contract,
			effective_range: yield* fieldValue(
				input.contract.effective_range,
				'employment_contract.effective_range'
			),
			prior_service_months: yield* fieldValue(
				input.contract.prior_service_months,
				'employment_contract.prior_service_months'
			),
			engagement: yield* fieldValue(input.contract.engagement, 'employment_contract.engagement'),
			exit_ground: yield* fieldValue(input.contract.exit_ground, 'employment_contract.exit_ground'),
			exit_facts: yield* fieldValue(input.contract.exit_facts, 'employment_contract.exit_facts')
		};
		const employee =
			input.employee === undefined
				? undefined
				: {
						...input.employee,
						date_of_birth: yield* fieldValue(
							input.employee.date_of_birth,
							'employment_profile.date_of_birth'
						),
						gender: yield* fieldValue(input.employee.gender, 'employment_profile.gender'),
						marital_status: yield* fieldValue(
							input.employee.marital_status,
							'employment_profile.marital_status'
						),
						nationality: yield* fieldValue(
							input.employee.nationality,
							'employment_profile.nationality'
						),
						children: yield* fieldValue(input.employee.children, 'employment_profile.children'),
						facts: yield* fieldValue(input.employee.facts, 'employment_profile.facts')
					};
		const entity =
			input.entity === undefined
				? undefined
				: {
						...input.entity,
						region: yield* fieldValue(input.entity.region, 'entity.region'),
						risk_class: yield* fieldValue(input.entity.risk_class, 'entity.risk_class'),
						pay_frequency: yield* fieldValue(input.entity.pay_frequency, 'entity.pay_frequency'),
						facts: yield* fieldValue(input.entity.facts, 'entity.facts')
					};
		const payroll = yield* fieldValue(input.version?.payroll, 'jurisdiction_settings.payroll');
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
			exit_facts: contract.exit_facts ?? {}
		};
		const birth = employee?.date_of_birth;
		const base_salary = term?.base_salary?.value ?? 0;
		const subject = {
			employee: {
				gender: employee?.gender ?? '',
				marital_status: employee?.marital_status ?? '',
				nationality: employee?.nationality ?? '',
				date_of_birth: birth ?? '',
				age: birth == null || birth === '' ? null : Math.floor(completedMonths(birth, day) / 12),
				children: employee?.children ?? [],
				facts: employee?.facts ?? {}
			},
			company: {
				region: entity?.region ?? '',
				risk_class: entity?.risk_class ?? '',
				pay_frequency: entity?.pay_frequency ?? '',
				headcount: input.headcount,
				facts: entity?.facts ?? {}
			},
			terms: {
				// Every key the term carries (a grade, a pay frequency, a department), beside the engine's own below.
				...term,
				work_classification: term?.work_classification ?? '',
				statutory_work_category: term?.statutory_work_category ?? '',
				employment_type: term?.employment_type ?? '',
				facts: term?.facts ?? {},
				residency_status: term?.residency_status ?? '',
				residency_since: term?.residency_since ?? '',
				base_salary,
				effective_from: term?.effective_range?.from ?? '',
				effective_to: term?.effective_range?.to ?? '',
				allowances: (term?.allowances ?? []).map((line) => ({
					code:
						line.code ??
						(line.catalogue_id == null ? '' : (input.allowanceCodes?.get(line.catalogue_id) ?? '')),
					catalogue_id: line.catalogue_id ?? '',
					amount: line.amount.value
				})),
				monthly_wage: 0
			},
			employment,
			person: {
				employment,
				nationality: employee?.nationality ?? null,
				residency_status: term?.residency_status ?? null,
				residency_since: term?.residency_since ?? null
			}
		};
		// The monthly wage: the governing version's required `payroll.monthly_wage` CEL on `terms`; null without a version.
		const rule = payroll?.monthly_wage;
		if (input.version !== undefined && (rule == null || rule.trim() === ''))
			return yield* Result.fail(
				new Refusal({
					message: `jurisdiction_settings ${input.version.code} needs payroll.monthly_wage: the CEL on terms defining the monthly wage.`
				})
			);
		const wage =
			rule == null ? null : (numberOf(evaluateConfigured(rule, { terms: subject.terms })) ?? 0);
		return { ...subject, terms: { ...subject.terms, monthly_wage: wage } };
	});
/** The payroll subject: the CEL roots `employee`, `company`, `terms`, `employment` and `person`. */
export type Subject = Result.Result.Success<ReturnType<typeof subjectContext>>;
/** How many of the entity's contracts are in force on a day: the CEL `company.headcount` (and `headcount`). */
export const schemePart = (target: string): [scheme: string, part: string] => {
	const [scheme = '', part = 'ordinary'] = target.split('.');
	return [scheme, part.toLowerCase()];
};
/** Every part each scheme is paid in under one version's catalogues, `ordinary` always among them. */
export type SchemeParts = ReadonlyMap<string, ReadonlySet<string>>;
export const partsOf = (rows: readonly CatalogRow[]): SchemeParts => {
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
export const slipPeriod = (slip: PayslipRow): string => String(slip.salary_from ?? '').slice(0, 7);
/** One set of stored payslips summed: each line's amount by its component or catalogue code, the gross and net,
 * and each scheme's employee and employer charge and assessed base (`base`, and by wage part) under `statutory`. */
export const slipSums = (slips: readonly PayslipRow[]): DynObject => {
	const lines: {
		[code: string]: number;
	} = {};
	const statutory: {
		[code: string]: {
			employee: number;
			employer: number;
			base: number;
			parts: {
				[part: string]: number;
			};
		};
	} = {};
	let gross = 0;
	let net = 0;
	for (const slip of slips) {
		gross += slip.gross.toNumber();
		net += slip.net.toNumber();
		for (const line of [...(slip.base ?? []), ...(slip.adjustments ?? [])]) {
			const code = line.component_code;
			if (code != null && code !== '') lines[code] = round2((lines[code] ?? 0) + line.amount);
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
export type MonthTally = {
	worked_days: number;
	worked_hours: number;
	suspended_days: number;
	leave_days: {
		[code: string]: number;
	};
	suspended_days_by_kind: {
		[kind: string]: number;
	};
};
export const emptyTally = (): MonthTally => ({
	worked_days: 0,
	worked_hours: 0,
	suspended_days: 0,
	leave_days: {},
	suspended_days_by_kind: {}
});
export const earnedFrom = (input: {
	readonly history: readonly PayslipRow[];
	readonly period: string;
	readonly runKind: ReadonlyMap<string, string>;
	readonly contract: ContractRow;
	/** Per calendar month: the days and hours attendance recorded, and the days a work suspension covered. */
	readonly worked?: ReadonlyMap<string, MonthTally>;
	/** The month the year starts in (`payroll.tax_year_start_month`, default January). */
	readonly yearStartMonth?: number;
	/** `payroll.history_months`: the months `months` lists and `average` means. */
	readonly historyMonths: number;
}) =>
	Result.gen(function* () {
		const { history, period } = input;
		const previous = String(monthOf(addDays(`${period}-01`, -1)).from).slice(0, 7);
		const monthsBefore = (count: number) =>
			[...new Set(history.map(slipPeriod))]
				.filter(
					(month) =>
						month < period && month >= String(addMonths(`${period}-01`, -count)).slice(0, 7)
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
		const previousTerm = yield* termFor(input.contract, String(monthOf(`${previous}-01`).to));
		return {
			month: slipSums(history.filter((slip) => slipPeriod(slip) === period)),
			year: slipSums(
				history.filter(
					(slip) =>
						slipPeriod(slip) >= taxYearStart(period, input.yearStartMonth) &&
						slipPeriod(slip) < period
				)
			),
			months: monthsBefore(input.historyMonths),
			// The mean of the months above that had a slip: an average monthly wage.
			average: (() => {
				const months: readonly DynObject[] = monthsBefore(input.historyMonths);
				const mean = (key: 'gross' | 'net') =>
					months.length === 0
						? 0
						: round2(months.reduce((sum, month) => sum + num(month[key]), 0) / months.length);
				return { gross: mean('gross'), net: mean('net'), months: months.length };
			})(),
			history: monthsBefore(Math.max(LONG_HISTORY_MONTHS, input.historyMonths)),
			previous_month: {
				...slipSums(previousSlips),
				base_salary: previousTerm?.base_salary?.value ?? 0
			}
		};
	});
// Many employments share the same clocks and break windows. A fresh guest invocation owns these bounded caches;
// every key includes the zone, and the conversion retains the date library's DST behavior.
const localClocks = new Map<string, string>();
const breakBoundaries = new Map<string, number>();
const dateRanges = new Map<string, readonly string[]>();
const cachedCalendarValue = <V>(
	cache: Map<string, V>,
	key: string,
	convert: () => V,
	limit = 2048
): V => {
	const held = cache.get(key);
	if (held !== undefined) return held;
	const value = convert();
	if (cache.size >= limit) cache.clear();
	cache.set(key, value);
	return value;
};
/** A stored instant as local wall time `YYYY-MM-DDTHH:MM` in a zone, or null when it is not an instant. */
const localClock = (instant: unknown, zone: string): string | null => {
	const millis = Predicate.isString(instant) ? Date.parse(instant) : Number.NaN;
	return Number.isFinite(millis)
		? cachedCalendarValue(localClocks, `${zone}:${millis}`, () =>
				toCalendarDateTime(fromAbsolute(millis, zone)).toString().slice(0, 16)
			)
		: null;
};
/** A configured local minute anchored to its work date, including the next day of an overnight shift. */
const calendarMinute = (date: string, minute: number, zone: string): number => {
	const rounded = Math.round(minute);
	return cachedCalendarValue(breakBoundaries, `${zone}:${date}:${rounded}`, () =>
		toZoned(parseDateTime(`${date}T00:00`).add({ minutes: rounded }), zone)
			.toDate()
			.getTime()
	);
};
/**
 * The planner of one employment's days: the roster entry's shift definition, else the cycle day of the pattern its
 * terms in force name (anchored at the pattern's effective start, inside its range), else none.
 */
export const dayPlanner = (input: {
	readonly contract: Partial<Pick<ContractRow, 'facts'>>;
	readonly fallback: ContractTerm | undefined;
	readonly roster: ReadonlyMap<string, RosterInput>;
	readonly definitions: ReadonlyMap<string, ShiftDefinitionRow>;
	readonly patterns: ReadonlyMap<string, ShiftPatternRow>;
}) => {
	const shifts = new Map<string, PlannedShift>();
	return (date: string) =>
		Result.gen(function* () {
			const term = yield* termFor(input.contract, date);
			const patternId = (term ?? input.fallback)?.shift_pattern_id;
			const pattern = patternId == null ? undefined : input.patterns.get(patternId);
			const rostered = yield* fieldValue(
				input.roster.get(date)?.shift_definition_id,
				'roster_entry.shift_definition_id'
			);
			const id = plannedShiftId({
				date,
				rostered: rostered ?? null,
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
		});
};
/** Every date from `from` to `to`, both inclusive. */
export const datesFrom = (from: string, to: string): readonly string[] =>
	cachedCalendarValue(dateRanges, `${from}:${to}`, () =>
		from > to ? [] : eachDay(datePeriod(from, to))
	);
/**
 * A day clocked as one pair less the shift's planned break: the pair split around the break's window (centred on the
 * shift, local wall time in the zone), so worked hours and every interval check net it. Recorded breaks (more than
 * one interval) and a pair the window does not meet stay as they are.
 */
const netOfBreak = (
	intervals: NonNullable<RosterRow['worked_intervals']>,
	date: string,
	pause: PlannedShift['break'],
	zone: string
): NonNullable<RosterRow['worked_intervals']> => {
	const [only] = intervals;
	if (pause == null || intervals.length !== 1 || only?.end == null) return intervals;
	const from = calendarMinute(date, pause.from_minute, zone);
	const to = calendarMinute(date, pause.from_minute + pause.minutes, zone);
	const start = Date.parse(only.start);
	const end = Date.parse(only.end);
	if (!(start < to && from < end)) return intervals;
	return [
		...(start < from ? [{ start: only.start, end: Instant(new Date(from)) }] : []),
		...(to < end ? [{ start: Instant(new Date(to)), end: only.end }] : [])
	];
};
/** Recorded work for compliance, before paid shift hours and overtime rounding are applied. */
export const recordedWork = (
	intervals: NonNullable<RosterRow['worked_intervals']>,
	date: string,
	pause: PlannedShift['break'],
	zone: string
) => {
	const spans = netOfBreak(intervals, date, pause, zone)
		.flatMap((interval) =>
			interval.end == null ? [] : [[Date.parse(interval.start), Date.parse(interval.end)] as const]
		)
		.filter(([start, end]) => Number.isFinite(start) && start < end)
		.toSorted(([a], [b]) => a - b);
	return {
		spans,
		hours: spans.reduce((sum, [start, end]) => sum + (end - start), 0) / 3600000,
		intervals: spans.flatMap(([start, end]) => {
			const from = localClock(new Date(start).toISOString(), zone);
			const to = localClock(new Date(end).toISOString(), zone);
			return from == null || to == null ? [] : [{ start: from, end: to }];
		})
	};
};
/** Sorted spans (epoch milliseconds) split after their first `hours`: the spans within them and the rest. */
const splitSpans = (
	spans: readonly (readonly [number, number])[],
	hours: number
): readonly [(readonly [number, number])[], (readonly [number, number])[]] => {
	let left = hours * 3600000;
	const within: (readonly [number, number])[] = [];
	const rest: (readonly [number, number])[] = [];
	for (const [start, end] of spans) {
		const take = Math.min(end - start, Math.max(0, left));
		if (take > 0) within.push([start, start + take]);
		if (start + take < end) rest.push([start + take, end]);
		left -= take;
	}
	return [within, rest];
};

/** How the governing version credits attendance (`payroll.attendance`). */
export type AttendancePolicy = NonNullable<
	NonNullable<Exclude<SettingsRow['payroll'], Masked>>['attendance']
>;
/** The governing version's attendance terms; refuses a version without them or with a nonpositive step. */
export const attendancePolicy = (version: Pick<SettingsRow, 'code' | 'payroll'> | undefined) =>
	Result.gen(function* () {
		const payroll = yield* fieldValue(version?.payroll, 'jurisdiction_settings.payroll');
		const policy = payroll?.attendance;
		if (policy == null || !(policy.step_hours > 0))
			return yield* Result.fail(
				new Refusal({
					message: `jurisdiction_settings ${version?.code ?? ''} needs payroll.attendance: a positive step_hours, rounding, overtime_window and untimed_credit_day_types.`
				})
			);
		return policy;
	});
type CreditSpan = { readonly start: number; readonly end: number };
type CreditSegment = CreditSpan & {
	readonly kind: 'NORMAL' | 'OT';
	readonly offset_hours: number;
	readonly hours: number;
	readonly credited_intervals: readonly CreditSpan[];
};

/** Actual clock intersections with configured ordinary time and separately approved overtime windows. */
export const creditAttendance = (input: {
	readonly date: string;
	readonly intervals: readonly { readonly start: string; readonly end?: string | null }[] | null;
	readonly planned: PlannedShift | null;
	readonly plannedOvertimeHours?: number | null;
	readonly approvedOvertimeIntervals?:
		| readonly {
				readonly start: string;
				readonly end?: string | null;
				readonly break_minutes?: number | null;
		  }[]
		| null;
	readonly timeZone: string;
	readonly policy: AttendancePolicy;
}) => {
	const recorded = recordedWork(
		(input.intervals ?? []).map((interval) => ({
			start: Instant(interval.start),
			end: interval.end == null ? null : Instant(interval.end)
		})),
		input.date,
		input.planned?.break,
		input.timeZone
	);
	const complete =
		input.intervals != null && input.intervals.every((interval) => interval.end != null);
	const ordinaryAnchored = input.planned?.start_minute != null && input.planned.end_minute != null;
	const approved = Number.isFinite(input.plannedOvertimeHours)
		? Math.max(0, input.plannedOvertimeHours ?? 0)
		: 0;
	const mergeSpans = (spans: readonly CreditSpan[]): CreditSpan[] => {
		const joined: CreditSpan[] = [];
		for (const span of spans.toSorted((left, right) => left.start - right.start)) {
			const previous = joined.at(-1);
			if (previous != null && span.start <= previous.end)
				joined[joined.length - 1] = {
					start: previous.start,
					end: Math.max(previous.end, span.end)
				};
			else joined.push(span);
		}
		return joined;
	};
	const spansOf = (intervals: typeof input.intervals) =>
		mergeSpans(
			(intervals ?? []).flatMap((interval) => {
				const start = Date.parse(interval.start),
					end = interval.end == null ? Number.NaN : Date.parse(interval.end);
				return Number.isFinite(start) && start < end ? [{ start, end }] : [];
			})
		);
	const explicitOvertime = (input.approvedOvertimeIntervals ?? []).flatMap((interval) => {
		const start = Date.parse(interval.start),
			end = interval.end == null ? Number.NaN : Date.parse(interval.end);
		return Number.isFinite(start) && start < end
			? [{ start, end, break_minutes: interval.break_minutes ?? 0 }]
			: [];
	});
	const anchored = ordinaryAnchored || (approved > 0 && explicitOvertime.length > 0);
	if (!complete)
		return {
			anchored,
			ordinary_anchored: ordinaryAnchored,
			complete,
			recorded_hours: recorded.hours,
			matched_hours: 0,
			normal_hours: 0,
			overtime_hours: 0,
			target_hours: 0,
			credited_hours: 0,
			percent: null,
			segments: [],
			normal_intervals: [],
			overtime_intervals: [],
			recorded_intervals: recorded.spans.map(([start, end]) => ({ start, end }))
		};
	const windows: (CreditSpan & { readonly kind: 'NORMAL' | 'OT' })[] = [];
	const actual = spansOf(input.intervals);
	const subtract = (spans: readonly CreditSpan[], cuts: readonly CreditSpan[]): CreditSpan[] => {
		let remaining = [...spans];
		for (const cut of cuts)
			remaining = remaining.flatMap((span) =>
				cut.end <= span.start || span.end <= cut.start
					? [span]
					: [
							...(span.start < cut.start ? [{ start: span.start, end: cut.start }] : []),
							...(cut.end < span.end ? [{ start: cut.end, end: span.end }] : [])
						]
			);
		return remaining;
	};
	const paidWindows = (
		frame: CreditSpan,
		breakMinutes: number,
		configuredCentre?: CreditSpan
	): CreditSpan[] => {
		let breakBudget = Math.min(frame.end - frame.start, Math.max(0, breakMinutes) * 60000);
		if (!(breakBudget > 0)) return [frame];
		const interior: CreditSpan[] = [];
		const inside = actual.flatMap((span) => {
			const start = Math.max(frame.start, span.start),
				end = Math.min(frame.end, span.end);
			return start < end ? [{ start, end }] : [];
		});
		for (let index = 1; index < inside.length; index++) {
			const previous = inside[index - 1]!,
				next = inside[index]!;
			if (previous.end < next.start) interior.push({ start: previous.end, end: next.start });
		}
		const breaks: CreditSpan[] = [];
		const centre = [
			configuredCentre ?? {
				start: (frame.start + frame.end - breakBudget) / 2,
				end: (frame.start + frame.end + breakBudget) / 2
			}
		];
		const allocate = (candidates: readonly CreditSpan[]) => {
			for (const span of subtract(candidates, breaks)) {
				const take = Math.min(span.end - span.start, Math.max(0, breakBudget));
				if (take > 0) breaks.push({ start: span.start, end: span.start + take });
				breakBudget -= take;
			}
		};
		allocate(
			interior.flatMap((gap) =>
				centre.flatMap((center) => {
					const start = Math.max(gap.start, center.start),
						end = Math.min(gap.end, center.end);
					return start < end ? [{ start, end }] : [];
				})
			)
		);
		allocate(interior);
		allocate(centre);
		return subtract([frame], breaks);
	};
	const frame =
		input.planned?.start_minute != null && input.planned.end_minute != null
			? {
					start: calendarMinute(input.date, input.planned.start_minute, input.timeZone),
					end: calendarMinute(input.date, input.planned.end_minute, input.timeZone)
				}
			: null;
	if (frame != null && input.planned != null) {
		const pause = input.planned.break;
		for (const window of paidWindows(
			frame,
			pause?.minutes ?? 0,
			pause == null
				? undefined
				: {
						start: calendarMinute(input.date, pause.from_minute, input.timeZone),
						end: calendarMinute(input.date, pause.from_minute + pause.minutes, input.timeZone)
					}
		))
			windows.push({ kind: 'NORMAL', ...window });
	}
	// Without recorded windows, approved overtime runs on from the shift's end only where the version says so.
	if (approved > 0)
		for (const window of input.approvedOvertimeIntervals != null
			? subtract(
					mergeSpans(
						explicitOvertime.flatMap((window) => paidWindows(window, window.break_minutes))
					),
					frame == null ? [] : [frame]
				)
			: frame == null || input.policy.overtime_window !== 'AFTER_SHIFT'
				? []
				: [{ start: frame.end, end: frame.end + approved * 3600000 }])
			windows.push({ kind: 'OT', ...window });
	const portions = windows
		.filter((window) => window.start < window.end)
		.toSorted((left, right) => left.start - right.start)
		.map((window) => ({
			...window,
			intersections: complete
				? actual.flatMap(({ start, end }) => {
						const from = Math.max(start, window.start),
							to = Math.min(end, window.end);
						return from < to ? [{ start: from, end: to }] : [];
					})
				: []
		}));
	const duration = (spans: readonly CreditSpan[]) =>
		spans.reduce((sum, span) => sum + span.end - span.start, 0) / 3600000;
	const ordinaryTarget = duration(portions.filter((portion) => portion.kind === 'NORMAL'));
	const ordinaryActual = duration(
		portions
			.filter((portion) => portion.kind === 'NORMAL')
			.flatMap((portion) => portion.intersections)
	);
	let normalBudget =
		complete && anchored
			? ordinaryActual + 1e-9 >= ordinaryTarget
				? ordinaryTarget
				: roundHours(ordinaryActual, input.policy)
			: 0;
	let overtimeBudget =
		complete && anchored
			? roundHours(
					Math.min(
						approved,
						duration(
							portions
								.filter((portion) => portion.kind === 'OT')
								.flatMap((portion) => portion.intersections)
						)
					),
					input.policy
				)
			: 0;
	const normalHours = normalBudget,
		overtime = overtimeBudget;
	const segments: CreditSegment[] = [];
	let offset = 0;
	for (const portion of portions) {
		const credits: CreditSpan[] = [];
		let budget = portion.kind === 'NORMAL' ? normalBudget : overtimeBudget;
		for (const span of portion.intersections) {
			const take = Math.min(span.end - span.start, Math.max(0, budget * 3600000));
			if (take > 0) credits.push({ start: span.start, end: span.start + take });
			budget -= take / 3600000;
		}
		if (portion.kind === 'NORMAL') normalBudget = budget;
		else overtimeBudget = budget;
		const hours = (portion.end - portion.start) / 3600000;
		segments.push({
			kind: portion.kind,
			start: portion.start,
			end: portion.end,
			offset_hours: offset,
			hours,
			credited_intervals: credits
		});
		offset += hours;
	}
	const normal = segments
		.filter((segment) => segment.kind === 'NORMAL')
		.flatMap((segment) => segment.credited_intervals);
	const over = segments
		.filter((segment) => segment.kind === 'OT')
		.flatMap((segment) => segment.credited_intervals);
	return {
		anchored,
		ordinary_anchored: ordinaryAnchored,
		complete,
		recorded_hours: recorded.hours,
		matched_hours: duration(portions.flatMap((portion) => portion.intersections)),
		normal_hours: normalHours,
		overtime_hours: overtime,
		target_hours: offset,
		credited_hours: normalHours + overtime,
		percent:
			complete && anchored && offset > 0
				? Math.min(100, ((normalHours + overtime) / offset) * 100)
				: null,
		segments,
		normal_intervals: normal,
		overtime_intervals: over,
		recorded_intervals: recorded.spans.map(([start, end]) => ({ start, end }))
	};
};
/** One planned and recorded person-day as the CEL root `work.days[]` reads it. */
export const workDay = (input: {
	readonly date: string;
	readonly planned: PlannedShift | null;
	readonly row: RosterInput | undefined;
	readonly holiday: HolidayRow | undefined;
	readonly zone: string;
	/** The work suspension covering the day for this employment, if any. */
	readonly suspension?: SuspensionRow | undefined;
	/** The governing version's `payroll.attendance` (`attendancePolicy`). */
	readonly policy: AttendancePolicy;
}) =>
	Result.gen(function* () {
		const { row, policy } = input;
		const recorded = yield* fieldValue(row?.worked_intervals, 'roster_entry.worked_intervals');
		const banked = yield* fieldValue(
			row?.banked_overtime_hours,
			'roster_entry.banked_overtime_hours'
		);
		const plannedOvertime = yield* fieldValue(
			row?.planned_overtime_hours,
			'roster_entry.planned_overtime_hours'
		);
		const approvedOvertime = yield* fieldValue(
			row?.approved_overtime_intervals,
			'roster_entry.approved_overtime_intervals'
		);
		const band = yield* fieldValue(row?.banked_overtime_band, 'roster_entry.banked_overtime_band');
		const consent = yield* fieldValue(
			row?.overtime_consented_at,
			'roster_entry.overtime_consented_at'
		);
		const worksite = yield* fieldValue(row?.worksite, 'roster_entry.worksite');
		const facts = yield* fieldValue(row?.facts, 'roster_entry.facts');
		const credit = creditAttendance({
			date: input.date,
			intervals: recorded ?? null,
			planned: input.planned,
			plannedOvertimeHours: num(plannedOvertime),
			approvedOvertimeIntervals: approvedOvertime ?? null,
			timeZone: input.zone,
			policy
		});
		const recordedHours = credit.recorded_hours;
		const scheduled = input.planned?.scheduled_hours ?? 0;
		const overtime = credit.overtime_hours;
		// A day with no window to intersect is credited on its recorded hours, as overtime, when the version lists its type.
		const untimedPremium =
			!credit.anchored &&
			input.planned != null &&
			policy.untimed_credit_day_types.includes(input.planned.day_type);
		const attended =
			credit.complete &&
			input.planned != null &&
			(untimedPremium ? recordedHours : credit.matched_hours) > 0;
		const premiumHours = roundHours(recordedHours, policy);
		if (num(banked) > overtime + 1e-9)
			return yield* Result.fail(
				new Refusal({
					message: `${input.date}: banked overtime cannot exceed the day's ${overtime} overtime hours.`
				})
			);
		const [premiumSpans] = splitSpans(
			attended && untimedPremium
				? credit.recorded_intervals.map((span) => [span.start, span.end] as const)
				: [],
			premiumHours
		);
		const ordinary = credit.normal_intervals.map((span) => [span.start, span.end] as const);
		const overtimeSpans = untimedPremium
			? premiumSpans
			: credit.overtime_intervals.map((span) => [span.start, span.end] as const);
		const clocks = (list: readonly (readonly [number, number])[]) =>
			list.flatMap(([start, end]) => {
				const from = localClock(new Date(start).toISOString(), input.zone);
				const to = localClock(new Date(end).toISOString(), input.zone);
				return from == null || to == null ? [] : [{ start: from, end: to }];
			});
		return {
			date: input.date,
			day_type: input.planned?.day_type ?? '',
			shift_code: input.planned?.code ?? '',
			holiday_kind: input.holiday?.kind ?? '',
			holiday_name: input.holiday?.name ?? '',
			scheduled_hours: scheduled,
			planned_overtime_hours: plannedOvertime == null ? null : num(plannedOvertime),
			/** Precise attendance, before approval caps and the version's rounding. */
			recorded_hours: recordedHours,
			attendance_complete: credit.complete,
			/** Clock-intersected hourly credit; fixed monthly salary remains the catalogue's own calculation. */
			worked_hours: attended ? round2(untimedPremium ? premiumHours : credit.credited_hours) : 0,
			/** Closed attendance met a credited window, or the catalogue's untimed rest/off premium context. */
			worked: attended,
			overtime_hours: round2(overtime - num(banked)),
			approved_overtime_hours: overtime,
			banked_hours: num(banked),
			banked_band: band ?? '',
			incentive_hours: 0,
			payable_incentive_hours: 0,
			// the day's own overtime consent (per day, never the contract's): its instant, and whether there is one
			overtime_consented_at: consent == null ? null : consent,
			overtime_consented: consent != null,
			worksite: worksite ?? '',
			facts: facts ?? {},
			suspended:
				input.suspension == null
					? null
					: {
							kind: input.suspension.kind,
							from: input.suspension.starts_on,
							to: input.suspension.ends_on,
							facts: input.suspension.facts ?? {}
						},
			/** Credited clock intersections, preserving lateness and internal gaps rather than shifting paid time. */
			intervals: clocks(
				[...(untimedPremium ? premiumSpans : ordinary), ...overtimeSpans]
					.toSorted(([a], [b]) => a - b)
					.reduce<(readonly [number, number])[]>((joined, span) => {
						const last = joined.at(-1);
						if (last !== undefined && span[0] <= last[1])
							joined[joined.length - 1] = [last[0], Math.max(last[1], span[1])];
						else joined.push(span);
						return joined;
					}, [])
			),
			/** Time available to the catalogue's bands; rest/off retain their actual premium-day timing. */
			overtime_intervals: clocks(overtimeSpans)
		};
	});
type HourSums = {
	worked_hours: number;
	overtime_hours: number;
	paid_overtime_hours: number;
	incentive_hours: number;
};
/**
 * The CEL root `hours`: the employment's approved roster days summed over the period's calendar `month`, the
 * `previous_month`, the calendar `year` through this month and the `rolling` months ending with it — each `worked_hours`,
 * `overtime_hours`, `incentive_hours`, and the same sums by planned `day_type` and by `holiday_kind` (absent keys absent).
 */
export const hoursFrom = (input: {
	/** `payroll.rolling_hours_months`: the months `rolling` sums; required (`payrollMonths`). */
	readonly rollingMonths?: number;
	/** `payroll.history_months`: the months `months` lists. */
	readonly historyMonths: number;
	/** The governing version's `payroll.attendance`. */
	readonly policy: AttendancePolicy;
	/** The month the year starts in (`payroll.tax_year_start_month`). */
	readonly yearStartMonth?: number;
	readonly rows: readonly RosterRow[];
	readonly holidays: ReadonlyMap<string, HolidayRow>;
	readonly month: {
		readonly from: string;
		readonly to: string;
	};
	/** The settlement period's last day: `month_to_date` runs from the 1st to it. */
	readonly through: string;
	readonly planOn: ReturnType<typeof dayPlanner>;
	readonly zone: string;
	readonly incentiveByDate?: ReadonlyMap<string, number>;
}) =>
	Result.gen(function* () {
		const { month, rollingMonths } = input;
		if (rollingMonths == null)
			return yield* Result.fail(
				new Refusal({
					message:
						'The hours windows need payroll.rolling_hours_months: the months `hours.rolling` sums.'
				})
			);
		const recorded: {
			readonly date: string;
			readonly day_type: string;
			readonly holiday_kind: string;
			readonly sums: HourSums;
		}[] = [];
		for (const row of input.rows) {
			const day = yield* workDay({
				date: row.work_date,
				planned: yield* input.planOn(row.work_date),
				row,
				holiday: input.holidays.get(row.work_date),
				zone: input.zone,
				policy: input.policy
			});
			recorded.push({
				date: row.work_date,
				day_type: String(day.day_type ?? ''),
				holiday_kind: String(day.holiday_kind ?? ''),
				sums: {
					worked_hours: num(day.worked_hours),
					// Overtime worked, banked or paid: the caps count it either way.
					overtime_hours: round2(num(day.overtime_hours) + num(day.banked_hours)),
					paid_overtime_hours: num(day.overtime_hours),
					incentive_hours: input.incentiveByDate?.get(row.work_date) ?? 0
				}
			});
		}
		const add = (held: HourSums | undefined, sums: HourSums): HourSums => ({
			worked_hours: round2((held?.worked_hours ?? 0) + sums.worked_hours),
			overtime_hours: round2((held?.overtime_hours ?? 0) + sums.overtime_hours),
			paid_overtime_hours: round2((held?.paid_overtime_hours ?? 0) + sums.paid_overtime_hours),
			incentive_hours: round2((held?.incentive_hours ?? 0) + sums.incentive_hours)
		});
		const windows: {
			[name: string]: readonly [string, string];
		} = {
			month: [month.from, month.to],
			// A part of the month (a semi-monthly half) reads the month to its own end, earlier parts included.
			month_to_date: [month.from, input.through],
			previous_month: [String(addMonths(month.from, -1)), addDays(month.from, -1)],
			year: [`${taxYearStart(month.from.slice(0, 7), input.yearStartMonth)}-01`, month.to],
			rolling: [String(addMonths(month.from, 1 - rollingMonths)), month.to]
		};
		// One span's sums: in all, by planned day type (a published holiday again under `HOLIDAY`) and by holiday kind.
		const sumsOver = (days: typeof recorded) => {
			let total: HourSums = {
				worked_hours: 0,
				overtime_hours: 0,
				paid_overtime_hours: 0,
				incentive_hours: 0
			};
			const day_type: {
				[type: string]: HourSums;
			} = {};
			const holiday_kind: {
				[kind: string]: HourSums;
			} = {};
			const day_type_holiday_kind: {
				[type: string]: { [kind: string]: HourSums };
			} = {};
			for (const day of days) {
				total = add(total, day.sums);
				if (day.day_type !== '') day_type[day.day_type] = add(day_type[day.day_type], day.sums);
				if (day.holiday_kind !== '') {
					holiday_kind[day.holiday_kind] = add(holiday_kind[day.holiday_kind], day.sums);
					day_type['HOLIDAY'] = add(day_type['HOLIDAY'], day.sums);
					if (day.day_type !== '') {
						const byKind = (day_type_holiday_kind[day.day_type] ??= {});
						byKind[day.holiday_kind] = add(byKind[day.holiday_kind], day.sums);
					}
				}
			}
			return { ...total, day_type, holiday_kind, day_type_holiday_kind };
		};
		const out: DynObject = {};
		for (const [name, [from, to]] of Object.entries(windows))
			out[name] = sumsOver(recorded.filter((day) => day.date >= from && day.date <= to));
		// One entry per configured history month, this month last: a record sums the months it names.
		const { historyMonths } = input;
		out.months = Array.from({ length: historyMonths }, (_, i) => {
			const key = String(addMonths(month.from, i + 1 - historyMonths)).slice(0, 7);
			return { month: key, ...sumsOver(recorded.filter((day) => day.date.startsWith(key))) };
		});
		return out;
	});
/** The earliest roster day `hours` reads for a period starting on `from`: the first of `hours.months`. */
export const hoursStart = (from: string, historyMonths: number): string =>
	String(addMonths(String(monthOf(from).from), 1 - historyMonths));
// ponytail: `attendance` reads the 24 months before the day read (a previous service year); a longer one needs more.
export const ATTENDANCE_MONTHS = 24;
/**
 * The employment's days from 24 months before `asOf` (or its start) through `asOf`, as the leave entitlement's
 * `attendance` root counts them: the planned day type (the roster's shift, else the pattern of the terms in force),
 * recorded attendance, a published holiday, and the codes of the approved time off covering the day — each movement
 * named by its own class's code, whatever version captured it.
 */
/** The shared attendance window of a write batch, read once for every employment it touches. */
export const readAttendance = Effect.fnUntraced(function* (
	read: Read,
	employmentIds: readonly Id<'employment_contract'>[],
	companyIds: readonly Id<'entity'>[],
	span: { readonly from: string; readonly to: string }
) {
	const got = yield* read({
		roster_entry: {
			where: {
				employment_id: { in: employmentIds },
				work_date: { gte: PlainDate(span.from), lte: PlainDate(span.to) }
			},
			fields: ROSTER
		},
		leave_catalog_entry: {
			where: { employment_id: { in: employmentIds }, activity: { eq: 'TIME_OFF' } },
			fields: ['employment_id', 'catalog_id', 'occurred_on', 'days', 'from', 'to']
		},
		shift_definition: {
			where: { company_id: { in: companyIds } },
			fields: ['company_id', 'code', 'variant']
		},
		shift_pattern: {
			where: { company_id: { in: companyIds } },
			fields: ['company_id', 'pattern', 'effective_range']
		},
		holiday: {
			where: {
				company_id: { in: companyIds },
				date: { gte: PlainDate(span.from), lte: PlainDate(span.to) },
				published_at: { isNull: false }
			},
			fields: HOLIDAY
		},
		work_suspension: {
			where: {
				company_id: { in: companyIds },
				starts_on: { lte: PlainDate(span.to) },
				ends_on: { gte: PlainDate(span.from) }
			},
			fields: ['company_id', 'kind', 'starts_on', 'ends_on', 'worksite', 'employment_ids', 'facts']
		}
	});
	const { leave_catalog } = yield* read({
		leave_catalog: {
			where: { id: { in: idsOf(got.leave_catalog_entry.rows.map((row) => row.catalog_id)) } },
			fields: ['code']
		}
	});
	return {
		roster: got.roster_entry,
		leave: got.leave_catalog_entry,
		catalogues: leave_catalog,
		definitions: got.shift_definition,
		patterns: got.shift_pattern,
		holidays: got.holiday,
		suspensions: got.work_suspension
	};
});
/** The shared attendance window of a write batch (two reads), for every employment it touches. */
export type AttendanceRead = Effect.Success<ReturnType<typeof readAttendance>>;

export const attendanceDays = (
	contract: ContractRow,
	asOf: string,
	context: DynObject,
	zone: string,
	/** The version governing `asOf` (its suspension kinds), when the caller holds it. */
	governing?: SettingsRow,
	prefetched?: AttendanceRead
) =>
	Effect.gen(function* () {
		const from = [String(addMonths(asOf, -ATTENDANCE_MONTHS)), contract.effective_range?.from ?? '']
			.toSorted()
			.at(-1)!;
		const to = [asOf, contract.effective_range?.to ?? asOf].toSorted()[0]!;
		if (from > to) return [];
		// One read: the days, the time off with its classes' codes, and the entity's calendar over the window.
		const { read } = yield* Reads;
		const got =
			prefetched ??
			(yield* readAttendance(read, [contract.id], [contract.company_id], { from, to }));
		const roster = got.roster.rows.filter(
			(row) => row.employment_id === contract.id && row.work_date >= from && row.work_date <= to
		);
		const definitions = new Map<string, ShiftDefinitionRow>(
			got.definitions.rows
				.filter((row) => row.company_id === contract.company_id)
				.map((row) => [row.id, row])
		);
		const patterns = new Map<string, ShiftPatternRow>(
			got.patterns.rows
				.filter((row) => row.company_id === contract.company_id)
				.map((row) => [row.id, row])
		);
		const holidays = new Set<string>(
			got.holidays.rows
				.filter((row) => row.company_id === contract.company_id)
				.map((holiday) => holiday.date)
		);
		const leave = got.leave.rows.filter((row) => row.employment_id === contract.id);
		const codes = new Map<string, string>(got.catalogues.rows.map((row) => [row.id, row.code]));
		const suspensions = got.suspensions.rows.filter(
			(row) => row.company_id === contract.company_id
		);
		const version =
			governing ?? (yield* governingVersion(yield* entityOf(contract.company_id), asOf));
		const policy = yield* Effect.fromResult(attendancePolicy(version));
		const kinds = new Map(
			(yield* Effect.fromResult(
				fieldValue(version.suspension_kinds, 'jurisdiction_settings.suspension_kinds')
			)).map((kind) => [kind.code, kind])
		);
		const covered = leave.flatMap((row) => {
			const range = coverageRange(row.from, row.to, num(row.days, 1), row.occurred_on);
			return range == null || range.to < from
				? []
				: [{ range, code: codes.get(String(row.catalog_id)) ?? '' }];
		});
		const rosterOn = new Map<string, (typeof roster)[number]>(
			roster.map((row) => [row.work_date, row])
		);
		const planOn = dayPlanner({
			contract,
			fallback: yield* Effect.fromResult(termFor(contract, to)),
			roster: rosterOn,
			definitions,
			patterns
		});
		const out: AttendanceDay[] = [];
		for (const date of datesFrom(from, to)) {
			const planned = yield* Effect.fromResult(planOn(date));
			const day = yield* Effect.fromResult(
				workDay({
					date,
					planned,
					row: rosterOn.get(date),
					holiday: undefined,
					zone,
					policy
				})
			);
			const row = rosterOn.get(date);
			const term = yield* Effect.fromResult(termFor(contract, date));
			const worksite = yield* Effect.fromResult(worksiteOn(row, term));
			const suspension = suspensionOn(suspensions, contract.id, date, worksite);
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
								facts: suspension.facts ?? {}
							}
						});
			out.push({
				date,
				scheduled: work && effect.scheduled,
				worked: work && effect.scheduled && (day.worked === true || effect.counts_as_attended),
				holiday: holidays.has(date),
				banked_hours: num(
					yield* Effect.fromResult(
						fieldValue(row?.banked_overtime_hours, 'roster_entry.banked_overtime_hours')
					)
				),
				banked_band:
					(yield* Effect.fromResult(
						fieldValue(row?.banked_overtime_band, 'roster_entry.banked_overtime_band')
					)) ?? '',
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
	employment_id: Id<'employment_contract'>,
	asOf: string,
	attendance = false,
	/** The version governing `asOf`, when the caller holds it; else it is read. */
	governing?: SettingsRow,
	/** The employment read with `SUBJECT_ARMS`, when the caller holds it; else it is read. */
	preloaded?: Employment,
	attendanceRead?: AttendanceRead
) =>
	Effect.gen(function* () {
		const contract = preloaded ?? (yield* employmentOf(employment_id));
		if (contract == null)
			return yield* new Refusal({ message: 'This entry needs an actual employment.' });
		const entity = contract.company ?? undefined;
		const employee = contract.person ?? undefined;
		const slips = contract.payslip;
		const history = slips.map(({ run: _run, ...slip }) => slip);
		const runs = slips.flatMap((slip) =>
			slip.run?.id == null ? [] : [{ id: slip.run.id, kind: slip.run.kind }]
		);
		// The version governing the day: its tax year, monthly wage and zone shape the entitlement context.
		const found =
			governing ??
			(entity == null
				? undefined
				: yield* governingVersion(entity, asOf).pipe(
						Effect.catchTag('Refusal', () => Effect.succeed(undefined))
					));
		const payroll = yield* Effect.fromResult(
			fieldValue(found?.payroll, 'jurisdiction_settings.payroll')
		);
		const term = yield* Effect.fromResult(termFor(contract, asOf));
		const context: DynObject = {
			...(yield* Effect.fromResult(
				subjectContext({
					contract,
					employee,
					entity,
					term,
					day: asOf,
					headcount: yield* Effect.fromResult(inForce(entity?.employment_contract ?? [], asOf)),
					version: found
				})
			)),
			// the governing version's PAYROLL rule tables (a region table: `rules.regions.by_region[company.region]`)
			rules: payrollRules(found),
			earned: yield* Effect.fromResult(
				earnedFrom({
					history,
					period: asOf.slice(0, 7),
					runKind: new Map(runs.map((run) => [run.id, run.kind ?? ''])),
					contract,
					yearStartMonth: payroll?.tax_year_start_month ?? 1,
					// No governing version: no payroll history window to read.
					historyMonths:
						found === undefined
							? 0
							: yield* Effect.fromResult(payrollMonths(found, 'history_months'))
				})
			)
		};
		const days: readonly AttendanceDay[] | undefined = attendance
			? yield* attendanceDays(
					contract,
					asOf,
					context,
					yield* Effect.fromResult(zoneOf(entity ?? { time_zone: null }, found)),
					found,
					attendanceRead
				)
			: undefined;
		return { context, employmentStart: contract.effective_range?.from ?? null, days };
	});
/**
 * What `leaveState` reads for many employments at once, as one read: each employment as a leave subject with its
 * movements (each with its class's code), and the versions of their lineages over the days (by the entity's code: no
 * relation) with their classes.
 */
export const loadLeaveState = Effect.fnUntraced(function* (
	read: Read,
	wants: readonly { readonly employment_id: Id<'employment_contract'>; readonly asOf: string }[],
	options: { readonly allVersions?: boolean } = {}
) {
	const days = wants.map((want) => want.asOf).toSorted();
	const waves = yield* subjectWaves(read, [...new Set(wants.map((want) => want.employment_id))]);
	// the lineage is named by the entity's code (no relation): read beside the subjects' third wave
	const { jurisdiction_settings, ...third } = yield* read({
		...subjectClassesOf(waves),
		jurisdiction_settings: {
			where: {
				code: { in: idsOf(waves.second.entity.rows.map((row) => row.settings_code)) },
				voided_at: { isNull: true },
				sealed_at: { isNull: false },
				...(options.allVersions || days.length === 0
					? {}
					: {
							effective_range: {
								overlaps: { from: PlainDate(days[0]!), to: PlainDate(days.at(-1)!) }
							}
						})
			},
			fields: SETTINGS
		},
		'jurisdiction_settings.leave_catalog': { fields: LEAVE_CLASS },
		'jurisdiction_settings.rule_set': { fields: ['code', 'family', 'rules', 'settings_id'] }
	});
	return {
		...subjectsOf(waves, third),
		versions: jurisdiction_settings,
		classes: jurisdiction_settings.rows.flatMap((version) => version.leave_catalog),
		rules: jurisdiction_settings.rows.flatMap((version) => version.rule_set)
	};
});
/** What `leaveState` reads for many employments at once: three dependent reads. */
export type LeaveStateRead = Effect.Success<ReturnType<typeof loadLeaveState>>;
/**
 * One employment's leave state on a day: the leave classes of the version in force, every movement of the employment,
 * its length of service and the entitlement subject. Leave balances, previews and the exit encashment read it; a batch
 * passes `prefetched` (`loadLeaveState` over all its employments) and reads once.
 */
export const leaveState = (
	employment_id: Id<'employment_contract'>,
	asOf: string,
	prefetched?: LeaveStateRead
) =>
	Effect.gen(function* () {
		const { read } = yield* Reads;
		const got = prefetched ?? (yield* loadLeaveState(read, [{ employment_id, asOf }]));
		const contract = employmentFrom(got, employment_id);
		if (contract == null)
			return yield* new Refusal({ message: 'This entry needs an actual employment.' });
		const company = yield* companyOf(contract);
		const selected = yield* Effect.fromResult(
			versionOn(
				got.versions.rows.filter((held) => held.code === company.settings_code),
				company.settings_code,
				asOf
			)
		);
		const version = selected;
		const classes = selected.leave_catalog;
		const movements = contract.leave_catalog_entry;
		const parsed = classes.map(classFromRow);
		const codeOf = new Map(got.catalogues.rows.map((row) => [row.id, row.code]));
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
				contract.effective_range.from,
				asOf,
				yield* Effect.fromResult(
					fieldValue(contract.prior_service_months, 'employment_contract.prior_service_months')
				)
			)
		};
	});
/** Assemble one payroll run and its payslips from the records in force; nothing is written here. */
/** `admitted`: the request's own admission when the caller already ran it (each read is a crossing). */
export type SlipContext = {
	readonly subject: {
		readonly contract: ContractRow;
		readonly employee: EmployeeRow | undefined;
		readonly entity: EntityRow;
	};
	readonly jurisdiction: {
		readonly version: SettingsRow;
		readonly rules: DynObject;
		readonly statutoryRows: readonly StatutoryRow[];
		readonly schemeCodes: ReadonlyMap<string, string>;
		readonly workRows: readonly CatalogRow[];
		readonly allowanceRows: readonly CatalogRow[];
		/** Every contract allowance's captured class id outside the governing version, to its code. */
		readonly capturedAllowanceCodes: ReadonlyMap<string, string>;
		readonly classes: ReadonlyMap<string, CatalogRow>;
		readonly parts: SchemeParts;
		/** The governing ad hoc classes flagged `raise_on_exit`. */
		readonly exitClasses: readonly CatalogRow[];
		readonly validations: readonly Validation[];
		/** A statutory row of the version charges a month with no wage (`assess_without_wage`): keep a zero-wage slip. */
		readonly assessesWithoutWage: boolean;
	};
	readonly payroll: {
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
		/** The run's own warnings, for what a slip that is not kept still flags (a leaver's overpayment). */
		readonly notes: string[];
		/** Money to the payroll currency's minor units (or the version's `payroll.minor_units`). */
		readonly money: (value: number) => number;
		/** The run's pay day: `period.pay_date`. */
		readonly payDate: string;
		/** The month is paid at more than one frequency: each contract line settles the month to date. */
		readonly switched: boolean;
	};
	readonly attendance: {
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
		readonly definitions: ReadonlyMap<string, ShiftDefinitionRow>;
		readonly patterns: ReadonlyMap<string, ShiftPatternRow>;
		readonly eventStart: ReadonlyMap<string, string>;
		/** Every time-off movement of the run's employments, and each captured leave class's code. */
		readonly timeOff: readonly LeaveEventRow[];
		readonly leaveCodes: ReadonlyMap<string, string>;
		/** Each leave row's chain start: the first day of the back-to-back rows of its class it continues. */
		readonly chainFrom: ReadonlyMap<string, string>;
		readonly suspensions: readonly SuspensionRow[];
		/** The version's suspension catalogue: each kind's CEL decides what a suspended day does. */
		readonly kinds: ReadonlyMap<string, SuspensionKind>;
		/** Every approved leave row of the employment, settled or not: a switched month's month-to-date leave. */
		readonly monthLeave: readonly EntryRow[];
	};
	readonly history: {
		readonly payslips: readonly PayslipRow[];
		readonly runKind: ReadonlyMap<string, string>;
		/** Immutable contribution configurations captured by each earlier payroll run. */
		readonly statutoryConfigurations?: ReadonlyMap<string, readonly StatutoryRow[]>;
		/** Each salary run's settlement window, by run id. */
		readonly runWindows: ReadonlyMap<
			string,
			{
				readonly from: string;
				readonly to: string;
			}
		>;
	};
};
