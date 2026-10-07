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
const WINDOWS = ['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT'] as const;
export type LeaveWindow = (typeof WINDOWS)[number];
const Entitlement = Schema.Struct({
	unit: Schema.optional(Schema.String),
	/** CEL over `service_months`, `bands`, the subject roots and `taken`: the days the class grants; absent, the
	 * class is not metered. */
	days: Schema.optional(Schema.String),
	bands: Schema.optional(Schema.Array(Band)),
	window: Schema.optional(Schema.Literals(WINDOWS)),
	/** CEL over `entry` (a movement's columns and facts): the `EVENT` window's key; absent, `entry.facts.event_id`. */
	window_key: Schema.optional(Schema.String),
	/** CEL on the previous window's context: the most unused days of that window carried into this one. */
	carry_forward: Schema.optional(Schema.String)
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

/** Where a balance is read: its day, the employment's start (service years) and the event being admitted, plus
 * the subject roots (`employee`, `terms`, `employment`, `earned`, …) the entitlement CEL reads. */
export type LeaveWindowInput = {
	readonly asOf?: string | null;
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

export function dayEnd(value: unknown): string | null {
	return isJsonObject(value) ? dayKey(value.to) : null;
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

/** Whether a movement falls in a window read at `where`, keyed by `cls` for an `EVENT` window. */
function inWindow(
	window: LeaveWindow,
	movement: LeaveMovement,
	where: LeaveWindowInput,
	cls?: LeaveClass
): boolean {
	const day = movementDay(movement);
	const asOf = where.asOf ?? null;
	if (window === 'EVENT') {
		const key = where.entry == null ? (where.eventId ?? null) : eventKey(cls, where.entry);
		return key != null && eventKey(cls, movement) === key;
	}
	if (window === 'CALENDAR_YEAR')
		return asOf == null || (day != null && day.slice(0, 4) === asOf.slice(0, 4));
	if (window === 'SERVICE_YEAR') {
		const year =
			asOf == null || where.employmentStart == null
				? null
				: serviceYear(where.employmentStart, asOf);
		return year == null || (day != null && day >= year.from && day <= year.to);
	}
	return true;
}

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
		event: sum('EVENT')
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
		taken: takenOf(cls.code, input.classes, input.movements, input)
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
	const ids = new Set(
		classes.filter((cls) => cls.code === code || cls.consumes_code === code).map((cls) => cls.id)
	);
	let total = 0;
	for (const movement of movements) {
		if (!ids.has(movement.catalog_id)) continue;
		if (!inWindow(window, movement, where, keyed)) continue;
		if (held ? movement.approval_id == null : movement.approval_id != null) continue;
		total += signedDays(movement.activity, daysOf(movement));
	}
	return total;
}

/** The last day of the window before the one holding `asOf`, for windows that follow one another. */
function previousWindowEnd(window: LeaveWindow, where: LeaveWindowInput): string | null {
	const asOf = where.asOf ?? null;
	if (asOf == null) return null;
	if (window === 'CALENDAR_YEAR') return `${Number(asOf.slice(0, 4)) - 1}-12-31`;
	if (window === 'SERVICE_YEAR' && where.employmentStart != null) {
		const year = serviceYear(where.employmentStart, asOf);
		return year == null ? null : String(addDays(year.from, -1));
	}
	return null;
}

/**
 * The days a class carries into the window holding `asOf`: the previous window's entitlement less what it took, capped
 * by the class's own `carry_forward` CEL read on that window. Carried days carry once: they do not roll on again.
 */
function carriedInto(
	cls: LeaveClass,
	input: {
		readonly classes: readonly LeaveClass[];
		readonly movements: readonly LeaveMovement[];
		readonly serviceMonths: number;
	} & LeaveWindowInput
): number {
	const rule = cls.entitlement?.carry_forward;
	const window = cls.entitlement?.window ?? 'LIFETIME';
	const end = previousWindowEnd(window, input);
	if (rule == null || rule.trim() === '' || end == null || input.asOf == null) return 0;
	if (input.employmentStart != null && end < input.employmentStart) return 0;
	const previous = {
		...input,
		asOf: end,
		serviceMonths: Math.max(0, input.serviceMonths - completedMonths(end, input.asOf))
	};
	const used =
		debitFor(cls.code, input.classes, input.movements, false, previous) +
		debitFor(cls.code, input.classes, input.movements, true, previous);
	const unused = classEntitlement(cls, previous) - used;
	const cap =
		numberOf(
			evaluateConfigured(rule, {
				...input.context,
				as_of: end,
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
} & LeaveWindowInput;

/**
 * Each class's balance read at one day: its entitlement CEL on the subject roots and `taken`, less the approved
 * (taken) and held (reserved) movements inside the class's window. A listing (no `entry` or event named) also gives a
 * `window_key` class one view per key its movements carry, read on that key's first movement as `entry`.
 */
export function leaveBalances(input: BalanceInput): LeaveBalance[] {
	const listing = input.entry == null && input.eventId == null;
	return input.classes.flatMap((cls) => {
		if (!listing || keyRule(cls) == null) return [balanceOf(cls, input, '')];
		const ids = new Set(input.classes.filter((row) => row.code === cls.code).map((row) => row.id));
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
			balanceOf(cls, { ...input, context: { ...input.context, entry: { facts: {} } } }, ''),
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
			available = Math.min(
				available,
				Math.max(
					0,
					classEntitlement(pool, input) + carriedInto(pool, input) - poolTaken - poolReserved
				)
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
		window_key
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
	} & Pick<LeaveWindowInput, 'employmentStart' | 'context'>
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
		...(input.context === undefined ? {} : { context: input.context })
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
		entitlement: Option.isNone(parsed) ? null : parsed.value
	};
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
