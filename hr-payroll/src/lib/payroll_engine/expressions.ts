import { Schema } from 'effect';
import { Environment, type Context as CelContext, type ParseResult } from '@marcbachmann/cel-js';
import { addDays, addMonths, datePeriod, days, monthOf } from '@norbital-ai/std/date';
import {
	type DynObject,
	type DynValue,
	type Json,
	completedMonths,
	getErrorMessage,
	isCalendarDate,
	isDynObject,
	numberOf,
	Refusal
} from './foundation.js';

/** The functions the environment carries, registered once when it is first built. */
const registrations: [signature: string, handler: (...args: never[]) => unknown][] = [];
let built: Environment | undefined;
/**
 * One deliberate expression environment: values arrive as stored JSON, no implicit coercion. It is built at first use,
 * never at module top level: cel-js makes native-backed TextEncoder/TextDecoder objects, which the guest's V8 startup
 * snapshot cannot restore. Catalogue, statutory and behaviour CEL all evaluate here.
 */
const environment = (): Environment => {
	if (built === undefined) {
		const built_ = new Environment({
			unlistedVariablesAreDyn: true,
			homogeneousAggregateLiterals: false
		});
		for (const [signature, handler] of registrations) built_.registerFunction(signature, handler);
		built = built_; // only a complete environment is cached: a throw mid-registration never sticks
	}
	return built;
};

const ROUND_MODES = ['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'TRUNCATE'] as const;
type RoundMode = (typeof ROUND_MODES)[number];

const roundModeOf = (mode: unknown): RoundMode => {
	if (mode == null) return 'HALF_UP';
	const found = ROUND_MODES.find((allowed) => allowed === String(mode));
	if (found === undefined) throw new Refusal({ message: `Unknown rounding mode: ${String(mode)}` });
	return found;
};

/** Round to `step` under one declared mode. */
const roundStep = (value: number, step: number, mode: RoundMode): number => {
	if (!(step > 0)) throw new Refusal({ message: 'Rounding requires a positive step.' });
	const units = Math.abs(value / step);
	const epsilon = 1e-9;
	const floor = Math.floor(units + epsilon);
	const fraction = units - floor;
	const whole =
		mode === 'HALF_UP'
			? Math.floor(units + 0.5 + epsilon)
			: mode === 'HALF_EVEN'
				? fraction > 0.5 + epsilon || (Math.abs(fraction - 0.5) <= epsilon && floor % 2 === 1)
					? floor + 1
					: floor
				: mode === 'UP'
					? Math.ceil(units - epsilon)
					: mode === 'DOWN'
						? floor
						: Math.trunc(units);
	// whole × step carries binary noise (311970 × 0.01 = 3119.7000000000003); 15 significant digits drop it.
	return Math.sign(value) * Number((whole * step).toPrecision(15));
};

const numeric = (value: unknown, context: string): number => {
	const number = Schema.is(Schema.BigInt)(value) ? Number(value) : numberOf(value);
	if (number == null)
		throw new Refusal({ message: `${context} requires an actual finite number.` });
	return number;
};

/** CEL numbers arrive as bigint; the engine's records speak JSON numbers. */
const normalize = (value: DynValue): Json => {
	if (Schema.is(Schema.BigInt)(value)) return Number(value);
	if (Array.isArray(value)) return value.map(normalize);
	if (isDynObject(value))
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
	return value;
};

const isDynValue = (value: unknown): value is DynValue =>
	Schema.is(Schema.BigInt)(value) || isDynObject(value) || Schema.is(Schema.Json)(value);

const listOf = (value: unknown, context: string): readonly DynValue[] => {
	if (!Array.isArray(value) || !value.every(isDynValue))
		throw new Refusal({ message: `${context} requires an actual list.` });
	return value;
};

const recordOf = (value: unknown, context: string): DynObject => {
	if (!isDynObject(value)) throw new Refusal({ message: `${context} requires an actual record.` });
	return value;
};

const dateOf = (value: unknown, context: string): string => {
	const day = Schema.is(Schema.String)(value) ? value.slice(0, 10) : '';
	if (!isCalendarDate(day))
		throw new Refusal({ message: `${context} requires an actual calendar date.` });
	return day;
};

const register = (
	name: string,
	arities: readonly number[],
	handler: (...args: unknown[]) => unknown
): void => {
	for (const arity of arities) {
		const signature = `${name}(${Array.from({ length: arity }, () => 'dyn').join(', ')}): dyn`;
		registrations.push([signature, handler]);
	}
};

const count = (value: unknown): number => Math.trunc(numeric(value, 'Calendar offset'));

// ── calendar: one canonical function each ─────────────────────────────────────────────────────────────────────────
register('add_days', [2], (day, n) => addDays(dateOf(day, 'Add days'), count(n)));
register('add_months', [2], (day, n) => addMonths(dateOf(day, 'Add months'), count(n)));
register('add_years', [2], (day, n) => addMonths(dateOf(day, 'Add years'), 12 * count(n)));
register('month_start', [1], (day) => monthOf(dateOf(day, 'Month start')).from);
register('month_end', [1], (day) => monthOf(dateOf(day, 'Month end')).to);
/** Signed days from `from` to `to`: zero on the same day. */
register('calendar_distance_days', [2], (from, to) => {
	const start = dateOf(from, 'Calendar distance');
	const end = dateOf(to, 'Calendar distance');
	return end >= start ? days(datePeriod(start, end)) - 1 : 1 - days(datePeriod(end, start));
});
register('calendar_completed_months', [2], (from, to) =>
	completedMonths(dateOf(from, 'Completed months'), dateOf(to, 'Completed months'))
);
register('months_through', [2], (from, to) => {
	const start = dateOf(from, 'Months through');
	const end = dateOf(to, 'Months through');
	return (
		(Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
		(Number(end.slice(5, 7)) - Number(start.slice(5, 7))) +
		1
	);
});
register('age_on', [2], (birth, day) =>
	Math.floor(completedMonths(dateOf(birth, 'Age'), dateOf(day, 'Age')) / 12)
);

/** The non-working dates a list names: date strings, or holiday rows by their `date`. */
const holidaySet = (value: unknown): ReadonlySet<string> =>
	new Set(
		(value == null ? [] : listOf(value, 'Working days')).map((item) =>
			dateOf(isDynObject(item) ? item['date'] : item, 'Working days')
		)
	);
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** The weekdays a record names as its weekend (`["SATURDAY", "SUNDAY"]`, `["FRIDAY", "SATURDAY"]`). */
const weekendOf = (value: unknown): ReadonlySet<number> =>
	new Set(
		listOf(value, 'Weekend').map((day) => {
			const index = WEEKDAYS.indexOf(String(day));
			if (index < 0) throw new Refusal({ message: `Weekend names no weekday: ${String(day)}` });
			return index;
		})
	);
const isWorkingDay = (
	day: string,
	holidays: ReadonlySet<string>,
	weekend: ReadonlySet<number>
): boolean => !weekend.has(new Date(`${day}T00:00:00Z`).getUTCDay()) && !holidays.has(day);
/** The day itself when it is a working day, else the next one: not a weekend day or a listed holiday. */
register('next_working_day', [3], (day, holidays, weekend) => {
	const off = holidaySet(holidays);
	const rest = weekendOf(weekend);
	let current = dateOf(day, 'Next working day');
	for (let guard = 0; !isWorkingDay(current, off, rest); guard++) {
		if (guard > 366) throw new Refusal({ message: 'Next working day found none within a year.' });
		current = String(addDays(current, 1));
	}
	return current;
});
/** `n` working days after (or, negative, before) the day, skipping weekend days and listed holidays. */
register('add_working_days', [4], (day, n, holidays, weekend) => {
	const off = holidaySet(holidays);
	const rest = weekendOf(weekend);
	if (rest.size === 7)
		throw new Refusal({ message: 'A weekend of every day leaves no working day.' });
	let current = dateOf(day, 'Add working days');
	const steps = count(n);
	const step = steps < 0 ? -1 : 1;
	for (let left = Math.abs(steps); left > 0;) {
		current = String(addDays(current, step));
		if (isWorkingDay(current, off, rest)) left--;
	}
	return current;
});

// ── numbers ────────────────────────────────────────────────────────────────────────────────────────────────────────
register('min', [2], (left, right) =>
	Math.min(numeric(left, 'Minimum'), numeric(right, 'Minimum'))
);
register('max', [2], (left, right) =>
	Math.max(numeric(left, 'Maximum'), numeric(right, 'Maximum'))
);
register('sum', [1], (list) =>
	listOf(list, 'Sum').reduce<number>((total, value) => total + numeric(value, 'Sum'), 0)
);
/**
 * How many items of a list sorted by `field` hold a value from `from` through `to` (both inclusive): two binary
 * searches, so a rolling-window threshold over every item is O(n log n). The list must be sorted by that field
 * (`separations` is, by `exit_date`).
 */
register('count_within', [4], (list, field, from, to) => {
	// Only the items the search touches are read: validating the whole list per call would make a window test O(n²).
	if (!Array.isArray(list)) throw new Refusal({ message: 'Count within requires an actual list.' });
	const items: readonly unknown[] = list;
	const key = String(field);
	const at = (i: number) => {
		const item = items[i];
		return isDynObject(item) ? String(item[key] ?? '') : '';
	};
	const bound = (value: string, strict: boolean) => {
		let low = 0;
		let high = items.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (strict ? at(mid) <= value : at(mid) < value) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	return Math.max(0, bound(String(to), true) - bound(String(from), false));
});

/** The `n` largest numbers of a list, largest first (the six highest monthly credits of a benefit). */
register('top', [2], (list, n) =>
	listOf(list, 'Top')
		.map((value) => numeric(value, 'Top'))
		.toSorted((left, right) => right - left)
		.slice(0, Math.max(0, count(n)))
);
register('round', [1, 2, 3], (value, step, mode) =>
	roundStep(
		numeric(value, 'Rounding'),
		step == null ? 1 : numeric(step, 'Rounding'),
		roundModeOf(mode)
	)
);

/** Indexed bracket: `[{up_to, rate|amount}, ...]` read low to high; the last band governs above its threshold. */
register('bracket', [2], (value, table) => {
	const amount = numeric(value, 'Bracket');
	const bands = listOf(table, 'Bracket');
	const figure = (band: unknown): number => {
		if (Array.isArray(band)) return numeric(band[1], 'Bracket');
		const record = recordOf(band, 'Bracket');
		return numeric('rate' in record ? record.rate : record.amount, 'Bracket');
	};
	for (const band of bands) {
		const upTo = Array.isArray(band) ? band[0] : recordOf(band, 'Bracket').up_to;
		if (upTo == null || amount <= numeric(upTo, 'Bracket')) return figure(band);
	}
	return bands.length === 0 ? 0 : figure(bands.at(-1));
});

/** Progressive bracket: each slice of `amount` beyond the previous threshold earns its band's rate. */
register('ladder', [2], (value, table) => {
	const amount = Math.max(0, numeric(value, 'Ladder'));
	let total = 0;
	let previous = 0;
	for (const band of listOf(table, 'Ladder')) {
		const pair = Array.isArray(band)
			? band
			: [recordOf(band, 'Ladder').up_to, recordOf(band, 'Ladder').rate];
		const upTo = pair[0] == null ? amount : numeric(pair[0], 'Ladder');
		const slice = Math.min(amount, upTo) - previous;
		if (slice > 0) total += slice * numeric(pair[1], 'Ladder');
		previous = upTo;
		if (amount <= upTo) break;
	}
	return total;
});

// ── clock windows ──────────────────────────────────────────────────────────────────────────────────────────────────
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const CLOCK = /^\d{2}:\d{2}$/;
const minuteOf = (local: string): number => Date.parse(`${local.slice(0, 16)}:00Z`) / 60_000;
const clockMinutes = (clock: unknown, context: string): number => {
	if (!Schema.is(Schema.String)(clock) || !CLOCK.test(clock))
		throw new Refusal({ message: `${context} requires an actual HH:MM clock.` });
	return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
};
/**
 * Hours of the intervals (`[{start, end}]`, local `YYYY-MM-DDTHH:MM`) inside a daily clock window `from`–`to`; a
 * window whose end is not after its start crosses midnight (`"22:00", "06:00"`). An open interval counts nothing.
 */
register('hours_between', [3], (intervals, from, to) => {
	const open = clockMinutes(from, 'Hours between');
	let close = clockMinutes(to, 'Hours between');
	if (close <= open) close += 1440;
	let minutes = 0;
	for (const item of listOf(intervals, 'Hours between')) {
		const interval = recordOf(item, 'Hours between');
		const start = interval['start'];
		const end = interval['end'];
		if (!Schema.is(Schema.String)(start) || !Schema.is(Schema.String)(end)) continue;
		if (!LOCAL.test(start) || !LOCAL.test(end))
			throw new Refusal({ message: 'Hours between requires local YYYY-MM-DDTHH:MM instants.' });
		const s = minuteOf(start);
		const e = minuteOf(end);
		// every window that can touch the interval: from the day before its start to its end day
		for (let day = Math.floor(s / 1440) * 1440 - 1440; day <= e; day += 1440)
			minutes += Math.max(0, Math.min(e, day + close) - Math.max(s, day + open));
	}
	return minutes / 60;
});

// cel-js has `map`/`filter`/`all`/`exists`; `sum` is above.
register('first', [1], (list) => listOf(list, 'first')[0] ?? null);

const programs = new Map<string, ParseResult>();

/** One parsed expression per source text; stored programmes keep their exact original text. */
export function configuredProgram(expression: string): (context: CelContext) => Json {
	if (!Schema.is(Schema.String)(expression) || expression.trim() === '')
		throw new Refusal({
			message: 'A configured expression retains its actual nonblank source text.'
		});
	let program = programs.get(expression);
	if (program === undefined) {
		program = environment().parse(expression);
		programs.set(expression, program);
	}
	return (context) => normalize(program!(context));
}

let configuredNestedDepth = 0;
/**
 * The nested `configured_eval` failures of the strict evaluation running now, kept even when CEL's commutative
 * `&&` / `||` absorbs them (`error && false` is false): a record's broken expression never reads as a quiet no.
 */
let failures: { readonly expression: string; readonly message: string }[] | undefined;

/** A record's own stored expression, evaluated from another (the encash rule reads `leave_catalog.entitlement.days`). */
registrations.push([
	'configured_eval(string, map): dyn',
	(expression: unknown, context: unknown) => {
		if (!Schema.is(Schema.String)(expression) || !isDynObject(context))
			throw new Refusal({
				message: 'Configured evaluation requires an expression and its captured record.'
			});
		if (configuredNestedDepth >= 16)
			throw new Refusal({ message: 'Configured evaluation exceeds its nested expression limit.' });
		configuredNestedDepth++;
		try {
			return configuredProgram(expression)(context);
		} catch (cause) {
			failures?.push({
				expression,
				message: getErrorMessage(cause)
			});
			throw cause;
		} finally {
			configuredNestedDepth--;
		}
	}
]);

/** One expression against its actual captured context. */
export const evaluateConfigured = (expression: string, context: CelContext): Json =>
	configuredProgram(expression)(context);

/**
 * `evaluateConfigured`, failing on any nested `configured_eval` failure too, absorbed or not. The refusal's `detail` is
 * the expression that failed — the innermost record expression, else this one — and its `message` the evaluator's.
 */
export const evaluateStrict = (expression: string, context: CelContext): Json => {
	const outer = failures;
	const mine: { readonly expression: string; readonly message: string }[] = [];
	failures = mine;
	let value: Json = null;
	try {
		value = evaluateConfigured(expression, context);
	} catch (cause) {
		mine.push({ expression, message: getErrorMessage(cause) });
	} finally {
		failures = outer;
	}
	const [first] = mine;
	if (first !== undefined) throw new Refusal({ message: first.message, detail: first.expression });
	return value;
};
