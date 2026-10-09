/**
 * L-TPL-hr-payroll-072/073/075/078: leave balances, preview, write refusals and roster coverage.
 * Catalogue bands and `leave_catalog_entry` movements are the source; nothing is stored as an account.
 */
import type { Id } from '@norbital-ai/bolt';
import { addDays, addMonths, datePeriod, days, PlainDate } from '@norbital-ai/std/date';
import { Option, Schema } from 'effect';
import { evaluateConfigured } from './expressions.js';
import {
	completedMonths,
	type DynObject,
	type HostRow,
	isDynObject,
	isJsonObject,
	numberOf
} from './foundation.js';

const isString = Schema.is(Schema.String);
const DATE = /^\d{4}-\d{2}-\d{2}/;

const Band = Schema.Struct({
	service_months: Schema.Number,
	days: Schema.Number
});
/** The span a class's balance is metered over: the default `LIFETIME` counts every movement of the employment. */
const WINDOWS = ['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT', 'ROLLING'] as const;
export type LeaveWindow = (typeof WINDOWS)[number];
const Entitlement = Schema.Struct({
	unit: Schema.optional(Schema.String),
	/** CEL over `service_months`, `bands`, the subject roots and `taken`: the days the class grants; absent, the
	 * class is not metered. */
	days: Schema.optional(Schema.String),
	bands: Schema.optional(Schema.Array(Band)),
	window: Schema.optional(Schema.Literals(WINDOWS)),
	/** `ROLLING`: the months the window reaches back from the day read (that day included). */
	window_months: Schema.optional(Schema.Number),
	/** `SERVICE_YEAR`: months after the employment start the first service year begins (a first grant at 6 months). */
	service_year_offset_months: Schema.optional(Schema.Number),
	/** CEL over `entry` (a movement's columns and facts): the `EVENT` window's key; absent, `entry.facts.event_id`. */
	window_key: Schema.optional(Schema.String),
	/** CEL on the previous window's context: the most unused days of that window carried into this one. */
	carry_forward: Schema.optional(Schema.String),
	/** How many windows on a day may still be carried (default 1: carried days carry once). */
	carry_depth: Schema.optional(Schema.Number),
	/** With `consumes_code`: the first N units of the class (in the pool's window) are its own; only those past N draw
	 * on the pool. */
	consumes_after_days: Schema.optional(Schema.Number),
	/** With `consumes_code` and a non-day `unit`: CEL over the subject (e.g. `terms.facts.daily_hours`) — the units
	 * one pool day holds, so hours draw on a day pool. */
	hours_per_day: Schema.optional(Schema.String)
});

export type LeaveEntitlement = Schema.Schema.Type<typeof Entitlement>;

export type LeaveClass = {
	readonly id: Id<'leave_catalog'>;
	readonly code: string;
	readonly name: string;
	readonly can_encash: boolean;
	readonly is_npl: boolean;
	readonly consumes_code: string | null;
	readonly entitlement: LeaveEntitlement | null;
	/** CEL on the employee (the subject roots): whether the class is theirs at all. Blank = everyone. */
	readonly eligibility?: string;
};

export type LeaveMovement = {
	readonly id?: string;
	readonly catalog_id: Id<'leave_catalog'>;
	readonly employment_id?: string;
	readonly activity: string;
	readonly occurred_on?: string | null;
	readonly approval_id?: string | null;
	readonly days?: number | null;
	readonly from?: string | null;
	readonly to?: string | null;
	/** The absence event the movement belongs to (`facts.event_id`): one birth, one illness, one bereavement. */
	readonly event_id?: string | null;
	/** The movement's open facts, which a class's `window_key` reads. */
	readonly facts?: { readonly [key: string]: unknown };
};

/** One employed day as the entitlement's `attendance` root counts it: a WORK day of the plan, whether attendance was
 * recorded on it, whether a published holiday falls on it, and the class codes of the approved time off covering it. */
export type AttendanceDay = {
	readonly date: string;
	readonly scheduled: boolean;
	readonly worked: boolean;
	readonly holiday: boolean;
	readonly leave: readonly string[];
	/** Overtime hours banked as time off on the day (`roster_entry.banked_overtime_hours`), and their band. */
	readonly banked_hours?: number;
	readonly banked_band?: string;
	/** The kind of the work suspension covering the day, if any, and that suspension's range. */
	readonly suspended?: string;
	readonly suspension?: { readonly kind: string; readonly from: string; readonly to: string };
};

/** Where a balance is read: its day, the employment's start (service years) and the event being admitted, plus
 * the subject roots (`employee`, `terms`, `employment`, `earned`, …) the entitlement CEL reads. */
export type LeaveWindowInput = {
	readonly asOf?: string | null;
	/** The employment's days up to `asOf`, when a class reads `attendance`. */
	readonly attendanceDays?: readonly AttendanceDay[];
	readonly employmentStart?: string | null;
	readonly eventId?: string | null;
	/** The movement being admitted or previewed: its `window_key` names the `EVENT` window read. */
	readonly entry?: LeaveMovement | null;
	readonly context?: DynObject;
};

/** The absence event key of an entry: its `facts.event_id`, or null. */
export const eventIdOf = (facts: unknown): string | null =>
	isJsonObject(facts) && isString(facts.event_id) && facts.event_id !== '' ? facts.event_id : null;

export type LeaveBalance = {
	readonly catalog_id: Id<'leave_catalog'>;
	readonly code: string;
	readonly name: string;
	readonly metered: boolean;
	readonly entitlement: number;
	/** Unused days of the previous window carried in, capped by the class's `carry_forward`. */
	readonly carried: number;
	readonly taken: number;
	readonly reserved: number;
	readonly available: number;
	/** A `window_key` class's key this view meters; blank for the class's own (next-event) view. */
	readonly window_key: string;
	/** The last day of the window this balance meters (blank for `LIFETIME` and `EVENT`). */
	readonly window_to: string;
	/** The class's `attendance` root as its entitlement read it, when it reads one. */
	readonly attendance?: DynObject;
};

export type LeavePreview = LeaveBalance & {
	readonly requested: number;
	readonly remaining: number;
	readonly ok: boolean;
	readonly covered_from: string;
	readonly covered_to: string;
};

export function dayKey(value: unknown): string | null {
	const held = isJsonObject(value) ? (value.$d ?? value.from) : value;
	return isString(held) && DATE.test(held) ? held.slice(0, 10) : null;
}

export function daysOf(movement: Pick<LeaveMovement, 'days'>): number {
	return numberOf(movement.days) ?? 0;
}

export function serviceMonthsAt(from: string | null, asOf: string, prior: unknown): number {
	const extra = from == null ? 0 : Math.max(0, completedMonths(from, asOf));
	return Math.max(0, (numberOf(prior) ?? 0) + extra);
}

/** The class's own entitlement expression at a length of service; the engine holds no proration or rounding rule. */
export function entitlementDays(
	entitlement: LeaveEntitlement | null,
	serviceMonths: number,
	context: DynObject = {}
): number {
	if (entitlement?.days == null) return 0;
	return (
		numberOf(
			evaluateConfigured(entitlement.days, {
				...context,
				service_months: serviceMonths,
				bands: entitlement.bands ?? []
			})
		) ?? 0
	);
}

const movementDay = (movement: LeaveMovement): string | null =>
	movement.from ?? movement.occurred_on ?? null;

/** The service year holding `asOf`: from the employment start's latest anniversary to the day before the next. */
function serviceYear(start: string, asOf: string): { from: string; to: string } | null {
	if (asOf < start) return null;
	const years = Math.floor(completedMonths(start, asOf) / 12);
	return {
		from: String(addMonths(start, 12 * years)),
		to: String(addDays(addMonths(start, 12 * (years + 1)), -1))
	};
}

/** A movement as the CEL `entry` a class reads: its open facts, then its columns. */
const movementEntry = (movement: LeaveMovement): DynObject => {
	const facts = isDynObject(movement.facts) ? movement.facts : {};
	return {
		...facts,
		facts,
		activity: movement.activity,
		days: daysOf(movement),
		from: movement.from ?? null,
		to: movement.to ?? null,
		occurred_on: movement.occurred_on ?? null
	};
};

/** The next movement before it is written, in the write context's shape: no facts, no days, no dates yet. */
const EMPTY_ENTRY: DynObject = {
	facts: {},
	activity: 'TIME_OFF',
	days: 0,
	from: null,
	to: null,
	occurred_on: null,
	incurred_on: null,
	due_on: null,
	amount: 0,
	quantity: 1
};

const keyRule = (cls: LeaveClass | undefined): string | null => {
	const rule = cls?.entitlement?.window_key;
	return rule == null || rule.trim() === '' ? null : rule;
};

/** A movement's `EVENT` window key under one class: its `window_key` CEL on the movement, else its `facts.event_id`. */
function eventKey(cls: LeaveClass | undefined, movement: LeaveMovement): string | null {
	const rule = keyRule(cls);
	if (rule == null) return movement.event_id ?? null;
	const key = evaluateConfigured(rule, { entry: movementEntry(movement) });
	return key == null || key === '' ? null : String(key);
}

/** The day service years count from: the employment start, moved by the class's `service_year_offset_months`. */
const serviceStart = (where: LeaveWindowInput, cls?: LeaveClass): string | null =>
	where.employmentStart == null
		? null
		: String(addMonths(where.employmentStart, cls?.entitlement?.service_year_offset_months ?? 0));

/** The span a window read at `where` covers; null for `LIFETIME`, `EVENT` and a read with no day. */
function windowRange(
	window: LeaveWindow,
	where: LeaveWindowInput,
	cls?: LeaveClass
): { from: string; to: string } | null {
	const asOf = where.asOf ?? null;
	if (asOf == null) return null;
	if (window === 'ROLLING')
		return {
			from: String(addDays(addMonths(asOf, -(cls?.entitlement?.window_months ?? 12)), 1)),
			to: asOf
		};
	if (window === 'CALENDAR_YEAR')
		return { from: `${asOf.slice(0, 4)}-01-01`, to: `${asOf.slice(0, 4)}-12-31` };
	if (window === 'SERVICE_YEAR') {
		const start = serviceStart(where, cls);
		if (start == null) return null;
		// Before an offset start, the employment's first months are a window of their own.
		return asOf < start && where.employmentStart != null && where.employmentStart < start
			? { from: where.employmentStart, to: String(addDays(start, -1)) }
			: serviceYear(start, asOf);
	}
	return null;
}

/** Whether `day` is the last day of a class's window (a calendar or service year, a rolling span): its window-end
 * encashment day. */
export function windowEndsOn(
	cls: LeaveClass,
	day: string,
	employmentStart: string | null
): boolean {
	return (
		windowRange(cls.entitlement?.window ?? 'LIFETIME', { asOf: day, employmentStart }, cls)?.to ===
		day
	);
}

/** Whether a movement falls in a window read at `where`, keyed by `cls` for an `EVENT` window. */
function inWindow(
	window: LeaveWindow,
	movement: LeaveMovement,
	where: LeaveWindowInput,
	cls?: LeaveClass
): boolean {
	if (window === 'LIFETIME') return true;
	if (window === 'EVENT') {
		const key = where.entry == null ? (where.eventId ?? null) : eventKey(cls, where.entry);
		return key != null && eventKey(cls, movement) === key;
	}
	const range = windowRange(window, where, cls);
	const day = movementDay(movement);
	return range == null || (day != null && day >= range.from && day <= range.to);
}

/** Scheduled (WORK) days of a span: how many, how many attended, on a holiday, and covered by each class's time off. */
function tally(days: readonly AttendanceDay[]): DynObject {
	const scheduled = days.filter((day) => day.scheduled);
	const leave: { [code: string]: number } = {};
	const suspended: { [kind: string]: number } = {};
	for (const day of scheduled) {
		for (const code of new Set(day.leave)) leave[code] = (leave[code] ?? 0) + 1;
		if (day.suspended != null && day.suspended !== '')
			suspended[day.suspended] = (suspended[day.suspended] ?? 0) + 1;
	}
	return {
		scheduled: scheduled.length,
		worked: scheduled.filter((day) => day.worked).length,
		holidays: scheduled.filter((day) => day.holiday).length,
		leave,
		suspended,
		banked_hours: days.reduce((total, day) => total + (day.banked_hours ?? 0), 0),
		// Each suspension the span's days fall in, once: `{ kind, from, to }`.
		suspensions: [
			...new Map(
				days.flatMap((day) =>
					day.suspension == null
						? []
						: [[`${day.suspension.kind}:${day.suspension.from}`, day.suspension] as const]
				)
			).values()
		],
		// Each banked day, its origin and band: a payout of untaken hours is priced per band.
		banked: days
			.filter((day) => (day.banked_hours ?? 0) > 0)
			.map((day) => ({ date: day.date, hours: day.banked_hours ?? 0, band: day.banked_band ?? '' }))
	};
}

/**
 * The CEL root `attendance`: the class's window holding the day read (`window`) and the one before it (`previous`;
 * empty for `LIFETIME` and `EVENT`, whose `window` runs from the employment start), each `from`, `to`, its `tally`
 * and `months[]` (one tally per calendar month, `month` its key). Only days up to the day read are counted.
 */
function attendanceOf(cls: LeaveClass, input: LeaveWindowInput): DynObject {
	const days = input.attendanceDays ?? [];
	const window = cls.entitlement?.window ?? 'LIFETIME';
	const asOf = input.asOf ?? '';
	const span = (range: { from: string; to: string }): DynObject => {
		const inside = days.filter((day) => day.date >= range.from && day.date <= range.to);
		const months = [...new Set(inside.map((day) => day.date.slice(0, 7)))].toSorted();
		return {
			...range,
			...tally(inside),
			months: months.map((month) => ({
				month,
				...tally(inside.filter((day) => day.date.startsWith(month)))
			}))
		};
	};
	const current = windowRange(window, input, cls) ?? {
		from: input.employmentStart ?? days[0]?.date ?? asOf,
		to: asOf
	};
	const before = String(addDays(current.from, -1));
	const previous =
		windowRange(window, input, cls) == null ||
		(input.employmentStart != null && before < input.employmentStart)
			? null
			: windowRange(window, { ...input, asOf: before }, cls);
	return { window: span(current), previous: span(previous ?? { from: '', to: '' }) };
}

/** Whether a class's stored rules read the `attendance` root: only then are its days tallied. */
export const readsAttendance = (cls: LeaveClass): boolean =>
	JSON.stringify(cls.entitlement ?? {}).includes('attendance');

/** Days of one class code taken (approved and held) in each window, as the entitlement CEL root `taken`. */
function takenOf(
	code: string,
	classes: readonly LeaveClass[],
	movements: readonly LeaveMovement[],
	where: LeaveWindowInput
): DynObject {
	const ids = new Set(classes.filter((cls) => cls.code === code).map((cls) => cls.id));
	const own = movements.filter((movement) => ids.has(movement.catalog_id));
	const keyed = classes.find((cls) => cls.code === code);
	const sum = (window: LeaveWindow) =>
		own
			.filter((movement) => inWindow(window, movement, where, keyed))
			.reduce((total, movement) => total + signedDays(movement.activity, daysOf(movement)), 0);
	return {
		calendar_year: sum('CALENDAR_YEAR'),
		service_year: sum('SERVICE_YEAR'),
		lifetime: sum('LIFETIME'),
		event: sum('EVENT'),
		rolling: sum('ROLLING')
	};
}

/** One class's entitlement on its own context: the subject roots plus what the class has already taken. */
const classEntitlement = (
	cls: LeaveClass,
	input: {
		readonly classes: readonly LeaveClass[];
		readonly movements: readonly LeaveMovement[];
		readonly serviceMonths: number;
	} & LeaveWindowInput
): number =>
	entitlementDays(cls.entitlement, input.serviceMonths, {
		...input.context,
		as_of: input.asOf ?? null,
		...(readsAttendance(cls) ? { attendance: attendanceOf(cls, input) } : {}),
		taken: takenOf(cls.code, input.classes, input.movements, input),
		// Another class's days in the same windows (an absence that forfeits this grant), by its code.
		taken_by_class: Object.fromEntries(
			[...new Set(input.classes.map((other) => other.code))].map((code) => [
				code,
				takenOf(code, input.classes, input.movements, input)
			])
		)
	});

export function metered(cls: LeaveClass): boolean {
	return cls.entitlement?.days != null;
}

function consumes(activity: string): boolean {
	return activity === 'TIME_OFF' || activity === 'ENCASHMENT';
}

function signedDays(activity: string, days: number): number {
	if (consumes(activity)) return days;
	if (activity === 'CARRY_FORWARD' || activity === 'ADJUSTMENT' || activity === 'REVERSAL')
		return -days;
	return 0;
}

function codesDebited(cls: LeaveClass): readonly string[] {
	return cls.consumes_code == null ? [cls.code] : [cls.code, cls.consumes_code];
}

function debitFor(
	code: string,
	classes: readonly LeaveClass[],
	movements: readonly LeaveMovement[],
	held: boolean,
	where: LeaveWindowInput
): number {
	const keyed = classes.find((cls) => cls.code === code);
	const window = keyed?.entitlement?.window ?? 'LIFETIME';
	const byId = new Map(
		classes
			.filter((cls) => cls.code === code || cls.consumes_code === code)
			.map((cls) => [String(cls.id), cls])
	);
	// Each debiting class's approved and held units in the window, by class code.
	const sums = new Map<string, { approved: number; held: number }>();
	for (const movement of movements) {
		const cls = byId.get(String(movement.catalog_id));
		if (cls == null || !inWindow(window, movement, where, keyed)) continue;
		const sum = sums.get(cls.code) ?? { approved: 0, held: 0 };
		const days = signedDays(movement.activity, daysOf(movement));
		if (movement.approval_id == null) sum.approved += days;
		else sum.held += days;
		sums.set(cls.code, sum);
	}
	let total = 0;
	for (const [owner, sum] of sums) {
		const cls = classes.find((row) => row.code === owner);
		const free = owner === code ? 0 : (cls?.entitlement?.consumes_after_days ?? 0);
		const rate = owner === code ? 1 : unitsPerDay(cls, where);
		if (free === 0 && rate === 1) {
			total += held ? sum.held : sum.approved;
			continue;
		}
		// Past its own first `consumes_after_days` units, a class draws on the pool at its units per pool day.
		const approved = Math.max(0, sum.approved - free);
		const all = Math.max(0, sum.approved + sum.held - free);
		total += (held ? all - approved : approved) / rate;
	}
	return total;
}

/** A consuming class's units per pool day: its `hours_per_day` CEL on the subject, else 1. */
function unitsPerDay(cls: LeaveClass | undefined, where: LeaveWindowInput): number {
	const rule = cls?.entitlement?.hours_per_day;
	if (rule == null || rule.trim() === '') return 1;
	const value = numberOf(evaluateConfigured(rule, where.context ?? {}));
	return value != null && value > 0 ? value : 1;
}

/** The last day of the window before the one holding `asOf`, for windows that follow one another. */
function previousWindowEnd(
	window: LeaveWindow,
	where: LeaveWindowInput,
	cls?: LeaveClass
): string | null {
	const asOf = where.asOf ?? null;
	if (asOf == null) return null;
	if (window === 'CALENDAR_YEAR') return `${Number(asOf.slice(0, 4)) - 1}-12-31`;
	const start = serviceStart(where, cls);
	if (window === 'SERVICE_YEAR' && start != null) {
		const year = serviceYear(start, asOf);
		return year == null ? null : String(addDays(year.from, -1));
	}
	return null;
}

/**
 * The days a class carries into the window holding `asOf`: the previous window's entitlement less what it took, capped
 * by the class's own `carry_forward` CEL read on that window. Carried days carry again for `carry_depth` windows (1).
 */
function carriedInto(
	cls: LeaveClass,
	input: {
		readonly classes: readonly LeaveClass[];
		readonly movements: readonly LeaveMovement[];
		readonly serviceMonths: number;
	} & LeaveWindowInput,
	depth = cls.entitlement?.carry_depth ?? 1
): number {
	const rule = cls.entitlement?.carry_forward;
	const window = cls.entitlement?.window ?? 'LIFETIME';
	const end = previousWindowEnd(window, input, cls);
	if (depth <= 0 || rule == null || rule.trim() === '' || end == null || input.asOf == null)
		return 0;
	if (input.employmentStart != null && end < input.employmentStart) return 0;
	const previous = {
		...input,
		asOf: end,
		serviceMonths: Math.max(0, input.serviceMonths - completedMonths(end, input.asOf))
	};
	const used =
		debitFor(cls.code, input.classes, input.movements, false, previous) +
		debitFor(cls.code, input.classes, input.movements, true, previous);
	// What the previous window held: its grant, plus what it carried in while days may still carry on.
	const unused = classEntitlement(cls, previous) + carriedInto(cls, previous, depth - 1) - used;
	const cap =
		numberOf(
			evaluateConfigured(rule, {
				...input.context,
				as_of: end,
				...(readsAttendance(cls) ? { attendance: attendanceOf(cls, previous) } : {}),
				taken: takenOf(cls.code, input.classes, input.movements, previous),
				service_months: previous.serviceMonths,
				bands: cls.entitlement?.bands ?? []
			})
		) ?? 0;
	return Math.max(0, Math.min(cap, unused));
}

type BalanceInput = {
	readonly classes: readonly LeaveClass[];
	readonly movements: readonly LeaveMovement[];
	readonly serviceMonths: number;
	/** A listing offered to the employee (the balances page, the request form): only the classes they are eligible for. */
	readonly offeredOnly?: boolean;
} & LeaveWindowInput;

/**
 * Each class's balance read at one day: its entitlement CEL on the subject roots and `taken`, less the approved
 * (taken) and held (reserved) movements inside the class's window. A listing (no `entry` or event named) also gives a
 * `window_key` class one view per key its movements carry, read on that key's first movement as `entry`.
 */
export function leaveBalances(input: BalanceInput): LeaveBalance[] {
	const listing = input.entry == null && input.eventId == null;
	// A listing reads every class on the next, still empty entry (its context's own, if the caller gave one).
	const blank = { ...input, context: { entry: EMPTY_ENTRY, ...input.context } };
	const offeredOnly = listing && input.offeredOnly === true;
	return input.classes
		.filter((cls) => !offeredOnly || offered(cls, blank.context))
		.flatMap((cls) => {
			if (!listing) return [balanceOf(cls, input, '')];
			if (keyRule(cls) == null) return [balanceOf(cls, blank, '')];
			const ids = new Set(
				input.classes.filter((row) => row.code === cls.code).map((row) => row.id)
			);
			const firsts = new Map<string, LeaveMovement>();
			for (const movement of input.movements
				.filter((row) => ids.has(row.catalog_id))
				.toSorted((left, right) =>
					`${movementDay(left) ?? ''}:${left.id ?? ''}`.localeCompare(
						`${movementDay(right) ?? ''}:${right.id ?? ''}`
					)
				)) {
				const key = eventKey(cls, movement);
				if (key != null && !firsts.has(key)) firsts.set(key, movement);
			}
			return [
				// The class's own view is the next event's: an `entry` with no facts yet.
				balanceOf(cls, { ...input, context: { ...input.context, entry: EMPTY_ENTRY } }, ''),
				...[...firsts].map(([key, first]) =>
					balanceOf(
						cls,
						{ ...input, entry: first, context: { ...input.context, entry: movementEntry(first) } },
						key
					)
				)
			];
		});
}

/**
 * Whether a listing offers a class: its eligibility holds on the subject. A class whose eligibility reads the request
 * (`entry`: a birth's facts) is the request's to decide, and one that cannot be read here stays: the write judges it.
 */
function offered(cls: LeaveClass, context: DynObject | undefined): boolean {
	if (cls.eligibility == null || /\bentry\b/.test(cls.eligibility)) return true;
	try {
		return (
			evaluateConfigured(cls.eligibility, {
				...context,
				earlier: { rows: [], calendar_year: 0, lifetime: 0 }
			}) !== false
		);
	} catch {
		return true;
	}
}

function balanceOf(cls: LeaveClass, input: BalanceInput, window_key: string): LeaveBalance {
	const entitlement = classEntitlement(cls, input);
	const carried = carriedInto(cls, input);
	const taken = Math.max(0, debitFor(cls.code, input.classes, input.movements, false, input));
	const reserved = Math.max(0, debitFor(cls.code, input.classes, input.movements, true, input));
	const own = entitlement + carried - taken - reserved;
	let available = metered(cls) ? Math.max(0, own) : 0;
	if (metered(cls) && cls.consumes_code != null) {
		const pool = input.classes.find((row) => row.code === cls.consumes_code);
		if (pool != null && metered(pool)) {
			const poolTaken = Math.max(
				0,
				debitFor(pool.code, input.classes, input.movements, false, input)
			);
			const poolReserved = Math.max(
				0,
				debitFor(pool.code, input.classes, input.movements, true, input)
			);
			// The pool's days left, in this class's units, beyond its own first free units.
			const free = Math.max(0, (cls.entitlement?.consumes_after_days ?? 0) - taken - reserved);
			available = Math.min(
				available,
				free +
					Math.max(
						0,
						classEntitlement(pool, input) + carriedInto(pool, input) - poolTaken - poolReserved
					) *
						unitsPerDay(cls, input)
			);
		}
	}
	return {
		catalog_id: cls.id,
		code: cls.code,
		name: cls.name,
		metered: metered(cls),
		entitlement,
		carried,
		taken,
		reserved,
		available,
		window_key,
		window_to: windowRange(cls.entitlement?.window ?? 'LIFETIME', input, cls)?.to ?? '',
		...(readsAttendance(cls) ? { attendance: attendanceOf(cls, input) } : {})
	};
}

/**
 * The days a range actually costs: only the ones the person is rostered to work. A shift cycle's rest and off days
 * and the entity's published holidays are skipped without shortening the range, and a half-day flag at either end
 * halves the first or last counted day.
 */
export function chargeableDays(input: {
	readonly from: string;
	readonly to?: string | null;
	readonly half_day_start?: boolean | null;
	readonly half_day_end?: boolean | null;
	/** The dates this person is not rostered to work: rest and off days, and public holidays. */
	readonly nonWorking?: ReadonlySet<string>;
}): number {
	const start = dayKey(input.from);
	if (start == null) return 0;
	const end = dayKey(input.to) ?? start;
	const first0 = PlainDate(start);
	const last0 = PlainDate(end);
	const span = last0 < first0 ? 0 : days(datePeriod(first0, last0));
	let worked = 0;
	for (let offset = 0; offset < span; offset++) {
		const date = String(addDays(first0, offset));
		if (input.nonWorking?.has(date) !== true) worked++;
	}
	if (worked === 0) return 0;
	const first = input.half_day_start === true ? 0.5 : 1;
	const last = input.half_day_end === true ? 0.5 : 1;
	if (worked === 1) return Math.min(first, last);
	return first + last + (worked - 2);
}

export function coverageRange(
	from: unknown,
	to: unknown,
	days: number,
	occurredOn?: unknown
): { readonly from: string; readonly to: string } | null {
	const start = dayKey(from) ?? dayKey(occurredOn);
	if (start == null) return null;
	const end = dayKey(to);
	if (end != null) return { from: start, to: end };
	const span = Math.max(1, days) - 1;
	return { from: start, to: addDays(PlainDate(start), span) };
}

export function coversDay(movement: LeaveMovement, day: string): boolean {
	if (movement.activity !== 'TIME_OFF') return false;
	const range = coverageRange(movement.from, movement.to, daysOf(movement), movement.occurred_on);
	return range != null && range.from <= day && day <= range.to;
}

export function refuseCoveredWorkDay(
	workDate: unknown,
	employmentId: unknown,
	leaves: readonly LeaveMovement[]
): string | null {
	const day = dayKey(workDate);
	const employment = isString(employmentId) ? employmentId : null;
	if (day == null || employment == null) return null;
	for (const movement of leaves) {
		if (movement.employment_id != null && movement.employment_id !== employment) continue;
		if (coversDay(movement, day)) return 'Leave already covers this day.';
	}
	return null;
}

export function refuseLeaveWrite(
	input: {
		readonly proposed: LeaveMovement;
		readonly classes: readonly LeaveClass[];
		readonly movements: readonly LeaveMovement[];
		readonly serviceMonths: number;
	} & Pick<LeaveWindowInput, 'employmentStart' | 'context' | 'attendanceDays'>
): string | null {
	const cls = input.classes.find((row) => row.id === input.proposed.catalog_id);
	if (cls == null) return 'Choose the entry’s class.';
	if (input.proposed.activity === 'ENCASHMENT' && !cls.can_encash)
		return `${cls.name} cannot be encashed.`;
	if (!consumes(input.proposed.activity)) return null;
	const pool =
		cls.consumes_code == null ? null : input.classes.find((row) => row.code === cls.consumes_code);
	if (!metered(cls) && (pool == null || !metered(pool))) return null;
	const others = input.movements.filter((row) => row.id == null || row.id !== input.proposed.id);
	const row = leaveBalances({
		classes: input.classes,
		movements: others,
		serviceMonths: input.serviceMonths,
		asOf: movementDay(input.proposed),
		eventId: input.proposed.event_id ?? null,
		entry: input.proposed,
		...(input.employmentStart === undefined ? {} : { employmentStart: input.employmentStart }),
		...(input.context === undefined ? {} : { context: input.context }),
		...(input.attendanceDays === undefined ? {} : { attendanceDays: input.attendanceDays })
	}).find((balance) => balance.catalog_id === cls.id);
	const days = daysOf(input.proposed);
	if (row != null && row.metered && days > row.available)
		return `This selection exceeds the available ${row.available} day(s).`;
	return null;
}

export function previewLeave(
	input: {
		readonly catalog_id: string;
		readonly days: number;
		readonly from?: unknown;
		readonly to?: unknown;
		readonly classes: readonly LeaveClass[];
		readonly movements: readonly LeaveMovement[];
		readonly serviceMonths: number;
	} & LeaveWindowInput
): LeavePreview | null {
	const row = leaveBalances(input).find((balance) => balance.catalog_id === input.catalog_id);
	if (row == null) return null;
	const requested = input.days;
	const remaining = row.metered ? row.available - requested : 0;
	const range = coverageRange(input.from, input.to, requested);
	return {
		...row,
		requested,
		remaining,
		ok: !row.metered || requested <= row.available,
		covered_from: range?.from ?? '',
		covered_to: range?.to ?? ''
	};
}

export function classFromRow(row: HostRow<'leave_catalog'>): LeaveClass {
	const parsed = Schema.decodeUnknownOption(Entitlement)(row.entitlement);
	const code = isString(row.code) ? row.code : row.id;
	return {
		id: row.id,
		code,
		name: isString(row.name) ? row.name : code,
		can_encash: row.can_encash !== false,
		is_npl: row.is_npl === true,
		consumes_code: isString(row.consumes_code) ? row.consumes_code : null,
		entitlement: Option.isNone(parsed) ? null : parsed.value,
		...(isString(row.eligibility) && row.eligibility.trim() !== ''
			? { eligibility: row.eligibility }
			: {})
	};
}

/**
 * Movements as the classes read here meter them: a movement captured under another version's class (`codeOf` names that
 * class's code) is re-keyed to the class of the same code, so a window spanning a version change counts it.
 */
export function movementsByCode(
	movements: readonly LeaveMovement[],
	classes: readonly LeaveClass[],
	codeOf: ReadonlyMap<string, string>
): LeaveMovement[] {
	const known = new Set<string>(classes.map((cls) => cls.id));
	const byCode = new Map(classes.map((cls) => [cls.code, cls.id]));
	return movements.map((movement) => {
		if (known.has(movement.catalog_id)) return movement;
		const id = byCode.get(codeOf.get(movement.catalog_id) ?? '');
		return id == null ? movement : { ...movement, catalog_id: id };
	});
}

/**
 * Each leave row's chain start: rows of one key (an employment's class code) back to back — the next starting the day
 * after the previous ends — are one continuous leave, so an extension entered as a new row keeps the first row's start.
 */
export function chainStarts(
	rows: readonly {
		readonly id: string;
		readonly key: string;
		readonly from: string;
		readonly to: string;
	}[]
): Map<string, string> {
	const out = new Map<string, string>();
	const ordered = rows
		.filter((row) => DATE.test(row.from))
		.toSorted((left, right) =>
			`${left.key}|${left.from}`.localeCompare(`${right.key}|${right.from}`)
		);
	let previous: (typeof ordered)[number] | undefined;
	for (const row of ordered) {
		const continues =
			previous != null &&
			previous.key === row.key &&
			DATE.test(previous.to) &&
			String(addDays(previous.to, 1)) === row.from;
		out.set(row.id, continues ? out.get(previous!.id)! : row.from);
		previous = row;
	}
	return out;
}

type LeaveMovementInput =
	| HostRow<'leave_catalog_entry'>
	| {
			readonly catalog_id: Id<'leave_catalog'>;
			readonly id?: string;
			readonly employment_id?: string;
			readonly activity?: string;
			readonly occurred_on?: unknown;
			readonly approval_id?: string | null;
			readonly days?: unknown;
			readonly from?: unknown;
			readonly to?: unknown;
			readonly facts?: unknown;
	  };

export function movementFromRow(row: LeaveMovementInput): LeaveMovement {
	const from = dayKey(row.from);
	const to = dayKey(row.to);
	const employment =
		row.employment_id == null || row.employment_id === '' ? undefined : String(row.employment_id);
	return {
		...(row.id !== undefined ? { id: row.id } : {}),
		catalog_id:
			row.catalog_id ??
			(() => {
				throw new Error('leave_catalog_entry row is missing catalog_id.');
			})(),
		...(employment === undefined ? {} : { employment_id: employment }),
		activity: isString(row.activity) ? row.activity : 'TIME_OFF',
		occurred_on: dayKey(row.occurred_on),
		approval_id: isString(row.approval_id) ? row.approval_id : null,
		days: numberOf(row.days) ?? 0,
		from: from ?? null,
		to: to ?? null,
		event_id: eventIdOf(row.facts),
		...(isJsonObject(row.facts) ? { facts: row.facts } : {})
	};
}
