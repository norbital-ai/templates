/**
 * The obligation ledger (L1), pure over read rows.
 *
 * A settings version declares its duty types (`jurisdiction_settings.duty_types`). An event — a finalised run, a
 * hire, an exit, a fact revision, a calendar occurrence, a case event — materialises one dated instance of every duty
 * type that listens for it and whose `when` holds. The due date, the amount and the retention are stored expressions
 * over the `obligation` site; none of it is engine code. Creation is idempotent on
 * `(duty_code, subject_kind, subject_id, trigger_ref)`, the collection's unique key.
 *
 * State is stored as OPEN, FULFILLED or WAIVED; LATE is derived against a day, never stored.
 */

import {
	evaluateBoolean,
	evaluateDate,
	evaluateNumber,
	expressionEngine
} from '../expressions/evaluate.js';
import { factValueFault, type FactKey } from '../datatypes/fact_keys.js';
import { addDays, inclusiveDays, monthDay } from '../payroll/run/dates.js';
import { cents } from '../payroll/run/rounding.js';
import { decodeNumber } from '../wire.js';

export const DUTY_SUBJECTS = ['COMPANY', 'EMPLOYMENT', 'WORKSITE', 'RUN', 'CASE'] as const;
export const DUTY_TRIGGERS = [
	'RUN_FINALISED',
	'HIRE',
	'EXIT',
	'FACT_CHANGE',
	'CALENDAR',
	'CASE_EVENT',
	/** Raised only by `scheduled_entries`, one instance per catalogue occurrence; `trigger.date` is its due day. */
	'SCHEDULED'
] as const;
export const DUTY_CADENCES = ['MONTH', 'QUARTER', 'YEAR'] as const;
export const DUTY_BLOCKS = ['EXIT', 'PAYMENT', 'RUN'] as const;
export const OBLIGATION_STATES = ['OPEN', 'FULFILLED', 'WAIVED'] as const;

export type DutySubject = (typeof DUTY_SUBJECTS)[number];
export type DutyTrigger = (typeof DUTY_TRIGGERS)[number];
export type DutyCadence = (typeof DUTY_CADENCES)[number];

/** One declared duty type, as `jurisdiction_settings.duty_types` stores it (absent members read `null`). */
export type DutyType = {
	readonly code: string;
	readonly label?: string | null;
	readonly authority: string;
	readonly subject: DutySubject;
	readonly trigger: {
		readonly on: DutyTrigger;
		/** Boolean over the obligation site; absent is always. */
		readonly when?: string | null;
		/** CALENDAR only: the calendar-aligned occurrence. */
		readonly every?: DutyCadence | null;
	};
	/** A `YYYY-MM-DD` expression over the obligation site. */
	readonly due: string;
	/** What completion records on the instance (`facts`); a key declaring `evidence` also needs its `fact_evidence` row. */
	readonly evidence?: readonly FactKey[] | null;
	/** Money over the obligation site: what the duty remits. */
	readonly amount?: string | null;
	/** Money over `obligation.amount_due` and `obligation.days_late`. */
	readonly late_charge?: string | null;
	/** Read by the stored checks (E9), never by this module. */
	readonly blocks?: (typeof DUTY_BLOCKS)[number] | null;
	/** Whole years over the obligation site: how long the record is kept from the due date. */
	readonly retain_years?: string | null;
};

type Facts = Readonly<Record<string, boolean | number | string>>;

/**
 * The `obligation` site. Every root is present on every event, blank where the trigger has none, so a duty's
 * expression reads `''`, `0` or `{}` rather than failing on a root its event does not carry.
 */
export type ObligationContext = {
	readonly trigger: { readonly on: string; readonly date: string; readonly ref: string };
	readonly period: { readonly start: string; readonly end: string };
	readonly company: {
		readonly settings_code: string;
		readonly region: string;
		readonly pay_frequency: string;
		readonly headcount: number;
		readonly facts: Facts;
	};
	readonly employment: {
		readonly service_start: string;
		readonly exit_date: string;
		readonly exit_ground: string;
		readonly exit_facts: Facts;
	};
	readonly worksite: { readonly code: string; readonly region: string; readonly facts: Facts };
	readonly run: {
		readonly period: string;
		readonly pay_date: string;
		readonly headcount: number;
		readonly gross: number;
		readonly net: number;
		readonly employer_cost: number;
		/** Payable per scheme code (`payroll_runs.company_remittances`). */
		readonly remittances: Readonly<Record<string, number>>;
		/** REGULAR | OFF_CYCLE | FINAL | CORRECTION. */
		readonly kind: string;
		/** The run's place among its period's runs, from 1. */
		readonly sequence: number;
		/** The day the run's wages fall due `YYYY-MM-DD`; `''` where none. */
		readonly pay_due_date: string;
		/** What the run withheld for third parties, by loan catalogue code (`thirdPartyWithheld`). */
		readonly withheld: Readonly<Record<string, number>>;
	};
	readonly case: { readonly type: string; readonly facts: Facts };
	/** The triggering record's own declared facts (a revision's, a case event's). */
	readonly event: { readonly facts: Facts };
};

type Roots = { readonly [K in keyof ObligationContext]?: Partial<ObligationContext[K]> };

const BLANK: ObligationContext = {
	trigger: { on: '', date: '', ref: '' },
	period: { start: '', end: '' },
	company: { settings_code: '', region: '', pay_frequency: '', headcount: 0, facts: {} },
	employment: { service_start: '', exit_date: '', exit_ground: '', exit_facts: {} },
	worksite: { code: '', region: '', facts: {} },
	run: {
		period: '',
		pay_date: '',
		headcount: 0,
		gross: 0,
		net: 0,
		employer_cost: 0,
		remittances: {},
		kind: 'REGULAR',
		sequence: 1,
		pay_due_date: '',
		withheld: {}
	},
	case: { type: '', facts: {} },
	event: { facts: {} }
};

/** A full obligation context from the roots an event knows. */
export function obligationContext(roots: Roots = {}): ObligationContext {
	return Object.fromEntries(
		Object.entries(BLANK).map(([root, blank]) => [
			root,
			{ ...blank, ...(roots[root as keyof Roots] ?? {}) }
		])
	) as ObligationContext;
}

/** One event a duty type can listen for. */
export type DutyEvent = {
	readonly on: DutyTrigger;
	readonly subject: { readonly kind: DutySubject; readonly id: string };
	/** The event's own identity under its subject (a period, an occurrence, a revision id); part of the unique key. */
	readonly ref: string;
	readonly date: string;
	/** CALENDAR only: the cadence of the occurrence. */
	readonly every?: DutyCadence | undefined;
	readonly context: ObligationContext;
};

/** The create input one duty instance becomes. */
export type ObligationInput = {
	readonly company_id: string;
	readonly settings_id: string;
	readonly duty_code: string;
	readonly authority: string;
	readonly subject_kind: DutySubject;
	readonly subject_id: string;
	readonly trigger_ref: string;
	readonly triggered_on: string;
	readonly due_on: string;
	readonly amount_due: number | null;
	readonly retain_until: string | null;
	readonly state: 'OPEN';
	readonly facts: Facts;
};

/** The unique key of an instance, as a string the callers keep in a set. */
export const instanceKey = (row: {
	readonly duty_code: string;
	readonly subject_kind: string;
	readonly subject_id: string;
	readonly trigger_ref: string;
}): string => [row.duty_code, row.subject_kind, row.subject_id, row.trigger_ref].join('\u0000');

const addYears = (day: string, years: number): string =>
	monthDay(
		decodeNumber(day.slice(0, 4)) + years,
		decodeNumber(day.slice(5, 7)) - 1,
		decodeNumber(day.slice(8, 10))
	);

/**
 * The instances an event raises: one per duty type listening for this trigger and subject whose `when` holds, less
 * those already recorded (`existing`, from `instanceKey`). Pure; the caller writes what it returns.
 */
export function materialise(options: {
	readonly duties: readonly DutyType[];
	readonly settingsId: string;
	readonly companyId: string;
	readonly currency?: string | undefined;
	readonly event: DutyEvent;
	readonly existing: ReadonlySet<string>;
}): ObligationInput[] {
	const { event } = options;
	const context = {
		...event.context,
		trigger: { on: event.on, date: event.date, ref: event.ref }
	};
	return options.duties.flatMap((duty) => {
		if (duty.trigger.on !== event.on || duty.subject !== event.subject.kind) return [];
		if (event.on === 'CALENDAR' && (duty.trigger.every ?? undefined) !== event.every) return [];
		const key = {
			duty_code: duty.code,
			subject_kind: duty.subject,
			subject_id: event.subject.id,
			trigger_ref: event.ref
		};
		if (options.existing.has(instanceKey(key))) return [];
		const when = duty.trigger.when?.trim();
		if (when && !evaluateBoolean(expressionEngine, when, context)) return [];
		const due_on = evaluateDate(expressionEngine, duty.due, context);
		const amount = duty.amount?.trim();
		const retain = duty.retain_years?.trim();
		return [
			{
				...key,
				company_id: options.companyId,
				settings_id: options.settingsId,
				authority: duty.authority,
				triggered_on: event.date,
				due_on,
				amount_due: amount
					? cents(evaluateNumber(expressionEngine, amount, context), options.currency)
					: null,
				retain_until: retain
					? addYears(due_on, Math.trunc(evaluateNumber(expressionEngine, retain, context)))
					: null,
				state: 'OPEN' as const,
				facts: {}
			}
		];
	});
}

/** Calendar months each cadence spans; a quarter is three months, a year twelve. */
const CADENCE_MONTHS: Readonly<Record<DutyCadence, number>> = { MONTH: 1, QUARTER: 3, YEAR: 12 };

/** One calendar-aligned occurrence: its key (`2026-01`, `2026-Q1`, `2026`) and its inclusive days. */
export type Occurrence = { readonly ref: string; readonly start: string; readonly end: string };

/**
 * The calendar-aligned occurrences of a cadence that overlap `from` and have started by `through`, oldest first.
 */
// ponytail: calendar-aligned only; a fiscal-year anchor (`every` plus a start month) when a duty needs one.
export function calendarOccurrences(
	every: DutyCadence,
	from: string,
	through: string
): Occurrence[] {
	const span = CADENCE_MONTHS[every];
	const year = decodeNumber(from.slice(0, 4));
	let index = Math.floor((decodeNumber(from.slice(5, 7)) - 1) / span) * span;
	const out: Occurrence[] = [];
	for (;;) {
		const start = monthDay(year, index, 1);
		if (start > through) return out;
		const end = addDays(monthDay(year, index + span, 1), -1);
		const y = start.slice(0, 4);
		const ref =
			every === 'YEAR'
				? y
				: every === 'QUARTER'
					? `${y}-Q${Math.floor((decodeNumber(start.slice(5, 7)) - 1) / span) + 1}`
					: start.slice(0, 7);
		out.push({ ref, start, end });
		index += span;
	}
}

type Instance = {
	readonly state: string;
	readonly due_on: string;
	readonly fulfilled_on?: string | null;
};

/** OPEN, LATE (open past its due day), FULFILLED or WAIVED on `today`. */
export function obligationStatus(
	instance: Instance,
	today: string
): 'OPEN' | 'LATE' | 'FULFILLED' | 'WAIVED' {
	if (instance.state !== 'OPEN') return instance.state as 'FULFILLED' | 'WAIVED';
	return today > instance.due_on ? 'LATE' : 'OPEN';
}

/** Calendar days past due on `today` (or on the fulfilment day); 0 when not late. */
export function daysLate(instance: Instance, today: string): number {
	const through = instance.state === 'FULFILLED' ? (instance.fulfilled_on ?? today) : today;
	return instance.state === 'WAIVED' || through <= instance.due_on
		? 0
		: inclusiveDays(instance.due_on, through) - 1;
}

/** The duty's stored late charge on `today`, or 0 where it declares none or the instance is not late. */
export function lateCharge(
	duty: Pick<DutyType, 'late_charge'>,
	instance: Instance & { readonly amount_due?: unknown },
	today: string,
	currency?: string
): number {
	const expression = duty.late_charge?.trim();
	const days = daysLate(instance, today);
	if (!expression || days === 0) return 0;
	const amount = decodeNumber(instance.amount_due);
	const context = {
		obligation: {
			amount_due: Number.isFinite(amount) ? amount : 0,
			days_late: days,
			due_on: instance.due_on
		}
	};
	return cents(evaluateNumber(expressionEngine, expression, context), currency);
}

/** The instances of one duty code still open on a subject: what a stored check's `obligations.open(code)` reads. */
export const openObligations = <R extends Instance & { readonly duty_code: string }>(
	instances: readonly R[],
	code: string
): R[] => instances.filter((row) => row.state === 'OPEN' && row.duty_code === code);

/**
 * Why an instance cannot be FULFILLED, or null: a fulfilment day, every evidence fact the duty declares recorded and
 * valid, each evidenced key's `fact_evidence` row, and the amount settled in full where one is due.
 */
export function fulfilmentFault(
	duty: Pick<DutyType, 'code' | 'evidence'>,
	instance: {
		readonly fulfilled_on?: string | null;
		readonly facts?: Readonly<Record<string, unknown>> | null;
		readonly amount_due?: unknown;
		readonly amount_settled?: unknown;
	},
	evidenced: ReadonlySet<string>
): string | null {
	if (instance.fulfilled_on == null || instance.fulfilled_on === '')
		return `${duty.code}: a fulfilled duty records the day it was fulfilled.`;
	const facts = instance.facts ?? {};
	for (const field of duty.evidence ?? []) {
		const label = field.label?.trim() || field.key;
		if (!Object.hasOwn(facts, field.key))
			return `${duty.code}: record ${label} before the duty is fulfilled.`;
		const fault = factValueFault(field, facts[field.key]);
		if (fault != null) return `${duty.code}: ${fault}`;
		if (field.evidence != null && !evidenced.has(field.key))
			return `${duty.code}: ${label} needs its evidence recorded before the duty is fulfilled.`;
	}
	const due = decodeNumber(instance.amount_due);
	const settled = decodeNumber(instance.amount_settled);
	if (Number.isFinite(due) && !(Number.isFinite(settled) && settled >= due))
		return `${duty.code}: ${due} is due; record the amount settled in full before the duty is fulfilled.`;
	return null;
}

/** The duty types a stored version declares; `[]` where it declares none. */
export const dutyTypesOf = (version: { readonly duty_types?: unknown } | null | undefined) =>
	(Array.isArray(version?.duty_types) ? version.duty_types : []) as readonly DutyType[];
