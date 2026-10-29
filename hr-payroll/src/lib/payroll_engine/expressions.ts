import { Array as EffectArray } from 'effect';
import { Predicate } from 'effect';
import { Result, Schema, SchemaTransformation } from 'effect';
import type { Context as CelContext } from '@marcbachmann/cel-js';
import { context as formulaContext, compile, evaluate } from '@norbital-ai/std/formula';
import { isPlainDate, addDays, addMonths, datePeriod, days, monthOf } from '@norbital-ai/std/date';
import { type Json, completedMonths, getErrorMessage, isDynObject, Refusal } from './foundation.js';
/** The functions the environment carries, registered once when it is first built. */
const registrations: [signature: string, handler: (...args: never[]) => unknown][] = [];
/** Declared roots belong to the caller's captured rule context; CEL cannot invent another root. */
const environments = new Map<string, ReturnType<typeof formulaContext>>();
const environment = (roots: readonly string[]) => {
	const key = [...roots].sort().join('\0');
	let held = environments.get(key);
	if (held === undefined) {
		held = formulaContext(
			Object.fromEntries(
				roots.map((name): [string, { readonly kind: 'json' }] => [name, { kind: 'json' }])
			),
			{
				numbers: 'float',
				functions: Object.fromEntries(
					registrations.map(
						(
							[signature, fn],
							index
						): [
							string,
							{ readonly signature: string; readonly fn: (typeof registrations)[number][1] }
						] => [String(index), { signature, fn }]
					)
				)
			}
		);
		environments.set(key, held);
	}
	return held;
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
/** Function arguments are decoded by Schema once at the registered-function boundary. */
const NUMBER = {
	schema: Schema.Union([
		Schema.Finite,
		Schema.NumberFromString.pipe(Schema.decodeTo(Schema.Finite)),
		Schema.BigInt.pipe(
			Schema.decodeTo(
				Schema.Finite,
				SchemaTransformation.transform({ decode: Number, encode: BigInt })
			)
		)
	]),
	requires: 'an actual finite number'
};
const Value = Schema.Union([
	Schema.Json,
	Schema.BigInt,
	Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.BigInt]))
]);
const LIST = { schema: Schema.Array(Value), requires: 'an actual list' };
const RECORD = {
	schema: Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.BigInt])),
	requires: 'an actual record'
};
const DATE = {
	schema: Schema.String.check(
		Schema.makeFilter((value: string) =>
			isPlainDate(value.slice(0, 10)) ? undefined : 'a valid calendar date'
		)
	).pipe(
		Schema.decodeTo(
			Schema.String,
			SchemaTransformation.transform({
				decode: (value) => value.slice(0, 10),
				encode: (value) => value
			})
		)
	),
	requires: 'an actual calendar date'
};
const argument = <A>(
	spec: { readonly schema: Schema.Decoder<A>; readonly requires: string },
	value: unknown,
	context: string
): A => {
	const decoded = Schema.decodeUnknownResult(spec.schema)(value);
	if (Result.isFailure(decoded))
		throw new Refusal({ message: `${context} requires ${spec.requires}.` });
	return decoded.success;
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
const count = (value: unknown): number => Math.trunc(argument(NUMBER, value, 'Calendar offset'));
// ── calendar: one canonical function each ─────────────────────────────────────────────────────────────────────────
register('add_days', [2], (day, n) => addDays(argument(DATE, day, 'Add days'), count(n)));
register('add_months', [2], (day, n) => addMonths(argument(DATE, day, 'Add months'), count(n)));
register('add_years', [2], (day, n) => addMonths(argument(DATE, day, 'Add years'), 12 * count(n)));
register('month_start', [1], (day) => monthOf(argument(DATE, day, 'Month start')).from);
register('month_end', [1], (day) => monthOf(argument(DATE, day, 'Month end')).to);
/** Signed days from `from` to `to`: zero on the same day. */
register('calendar_distance_days', [2], (from, to) => {
	const start = argument(DATE, from, 'Calendar distance');
	const end = argument(DATE, to, 'Calendar distance');
	return end >= start ? days(datePeriod(start, end)) - 1 : 1 - days(datePeriod(end, start));
});
register('calendar_completed_months', [2], (from, to) =>
	completedMonths(argument(DATE, from, 'Completed months'), argument(DATE, to, 'Completed months'))
);
register('months_through', [2], (from, to) => {
	const start = argument(DATE, from, 'Months through');
	const end = argument(DATE, to, 'Months through');
	return (
		(Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
		(Number(end.slice(5, 7)) - Number(start.slice(5, 7))) +
		1
	);
});
register('age_on', [2], (birth, day) =>
	Math.floor(completedMonths(argument(DATE, birth, 'Age'), argument(DATE, day, 'Age')) / 12)
);
/** The non-working dates a list names: date strings, or holiday rows by their `date`. */
const holidaySet = (value: unknown): ReadonlySet<string> =>
	new Set(
		(value == null ? [] : argument(LIST, value, 'Working days')).map((item) =>
			argument(DATE, isDynObject(item) ? item['date'] : item, 'Working days')
		)
	);
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** The weekdays a record names as its weekend (`["SATURDAY", "SUNDAY"]`, `["FRIDAY", "SATURDAY"]`). */
const weekendOf = (value: unknown): ReadonlySet<number> =>
	new Set(
		argument(LIST, value, 'Weekend').map((day) => {
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
	let current = argument(DATE, day, 'Next working day');
	for (let guard = 0; !isWorkingDay(current, off, rest); guard++) {
		if (guard > 366) throw new Refusal({ message: 'Next working day found none within a year.' });
		current = addDays(current, 1);
	}
	return current;
});
/** `n` working days after (or, negative, before) the day, skipping weekend days and listed holidays. */
register('add_working_days', [4], (day, n, holidays, weekend) => {
	const off = holidaySet(holidays);
	const rest = weekendOf(weekend);
	if (rest.size === 7)
		throw new Refusal({ message: 'A weekend of every day leaves no working day.' });
	let current = argument(DATE, day, 'Add working days');
	const steps = count(n);
	const step = steps < 0 ? -1 : 1;
	for (let left = Math.abs(steps); left > 0;) {
		current = addDays(current, step);
		if (isWorkingDay(current, off, rest)) left--;
	}
	return current;
});
// ── numbers ────────────────────────────────────────────────────────────────────────────────────────────────────────
const least = (values: readonly number[]) => {
	if (values.length === 0) throw new Refusal({ message: 'Minimum requires at least one number.' });
	return Math.min(...values);
};
/** The lesser of two numbers, or the least of a list (`min(rates)`: the lowest regional minimum wage). */
register('min', [1, 2], (left, right) =>
	right === undefined
		? least(argument(LIST, left, 'Minimum').map((value) => argument(NUMBER, value, 'Minimum')))
		: Math.min(argument(NUMBER, left, 'Minimum'), argument(NUMBER, right, 'Minimum'))
);
register('max', [2], (left, right) =>
	Math.max(argument(NUMBER, left, 'Maximum'), argument(NUMBER, right, 'Maximum'))
);
register('sum', [1], (list) =>
	argument(LIST, list, 'Sum').reduce<number>(
		(total, value) => total + argument(NUMBER, value, 'Sum'),
		0
	)
);
/**
 * How many items of a list sorted by `field` hold a value from `from` through `to` (both inclusive): two binary
 * searches, so a rolling-window threshold over every item is O(n log n). The list must be sorted by that field
 * (`separations` is, by `exit_date`).
 */
register('count_within', [4], (list, field, from, to) => {
	// Only the items the search touches are read: validating the whole list per call would make a window test O(n²).
	if (!EffectArray.isArray(list))
		throw new Refusal({ message: 'Count within requires an actual list.' });
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
	argument(LIST, list, 'Top')
		.map((value) => argument(NUMBER, value, 'Top'))
		.toSorted((left, right) => right - left)
		.slice(0, Math.max(0, count(n)))
);
register('round', [1, 2, 3], (value, step, mode) =>
	roundStep(
		argument(NUMBER, value, 'Rounding'),
		step == null ? 1 : argument(NUMBER, step, 'Rounding'),
		roundModeOf(mode)
	)
);
/** Indexed bracket: `[{up_to, rate|amount}, ...]` read low to high; the last band governs above its threshold. */
register('bracket', [2], (value, table) => {
	const amount = argument(NUMBER, value, 'Bracket');
	const bands = argument(LIST, table, 'Bracket');
	const figure = (band: unknown): number => {
		if (EffectArray.isArray(band)) return argument(NUMBER, band[1], 'Bracket');
		const record = argument(RECORD, band, 'Bracket');
		return argument(NUMBER, 'rate' in record ? record.rate : record.amount, 'Bracket');
	};
	for (const band of bands) {
		const upTo = EffectArray.isArray(band) ? band[0] : argument(RECORD, band, 'Bracket').up_to;
		if (upTo == null || amount <= argument(NUMBER, upTo, 'Bracket')) return figure(band);
	}
	return bands.length === 0 ? 0 : figure(bands.at(-1));
});
/** Progressive bracket: each slice of `amount` beyond the previous threshold earns its band's rate. */
register('ladder', [2], (value, table) => {
	const amount = Math.max(0, argument(NUMBER, value, 'Ladder'));
	let total = 0;
	let previous = 0;
	for (const band of argument(LIST, table, 'Ladder')) {
		const pair = EffectArray.isArray(band)
			? band
			: [argument(RECORD, band, 'Ladder').up_to, argument(RECORD, band, 'Ladder').rate];
		const upTo = pair[0] == null ? amount : argument(NUMBER, pair[0], 'Ladder');
		const slice = Math.min(amount, upTo) - previous;
		if (slice > 0) total += slice * argument(NUMBER, pair[1], 'Ladder');
		previous = upTo;
		if (amount <= upTo) break;
	}
	return total;
});
// ── clock windows ──────────────────────────────────────────────────────────────────────────────────────────────────
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const CLOCK = /^\d{2}:\d{2}$/;
const minuteOf = (local: string): number => Date.parse(`${local.slice(0, 16)}:00Z`) / 60000;
const clockMinutes = (clock: unknown, context: string): number => {
	if (!Predicate.isString(clock) || !CLOCK.test(clock))
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
	for (const item of argument(LIST, intervals, 'Hours between')) {
		const interval = argument(RECORD, item, 'Hours between');
		const start = interval['start'];
		const end = interval['end'];
		if (!Predicate.isString(start) || !Predicate.isString(end)) continue;
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
/** Maximum worked hours between gaps at least `minimumBreakMinutes` long; shorter gaps do not reset work. */
register('max_work_hours_between_breaks', [2], (intervals, minimumBreakMinutes) => {
	const minimum = argument(NUMBER, minimumBreakMinutes, 'Work between breaks');
	if (!(minimum > 0) || !Number.isFinite(minimum))
		throw new Refusal({ message: 'Work between breaks requires positive finite break minutes.' });
	const spans: {
		start: number;
		end: number;
	}[] = [];
	for (const item of argument(LIST, intervals, 'Work between breaks')) {
		const interval = argument(RECORD, item, 'Work between breaks');
		const start = interval['start'];
		const end = interval['end'];
		if (end == null) continue; // an open interval has no measured duration
		if (
			!Predicate.isString(start) ||
			!Predicate.isString(end) ||
			!LOCAL.test(start) ||
			!LOCAL.test(end)
		)
			throw new Refusal({
				message: 'Work between breaks requires local YYYY-MM-DDTHH:MM instants.'
			});
		const s = minuteOf(start),
			e = minuteOf(end);
		if (!Number.isFinite(s) || !Number.isFinite(e) || e < s)
			throw new Refusal({
				message: 'Work between breaks requires a finite end at or after its start.'
			});
		if (e > s) spans.push({ start: s, end: e });
	}
	spans.sort((a, b) => a.start - b.start || a.end - b.end);
	let lastEnd: number | undefined;
	let worked = 0,
		maximum = 0;
	for (const span of spans) {
		if (lastEnd === undefined || span.start - lastEnd >= minimum) worked = 0;
		// Overlaps and duplicated clock spans represent the same worked time.
		worked += Math.max(0, span.end - Math.max(span.start, lastEnd ?? span.start));
		lastEnd = Math.max(lastEnd ?? span.end, span.end);
		maximum = Math.max(maximum, worked);
	}
	return maximum / 60;
});
// cel-js has `map`/`filter`/`all`/`exists`; `sum` is above.
register('first', [1], (list) => argument(LIST, list, 'first')[0] ?? null);
/** One expression against explicitly declared roots, in the payroll floating-point mode. */
function configuredProgram(expression: string): (context: CelContext) => Json {
	const source = Schema.decodeUnknownResult(Schema.String)(expression);
	if (Result.isFailure(source) || source.success.trim() === '')
		throw new Refusal({
			message: 'A configured expression retains its actual nonblank source text.'
		});
	return (context) => {
		const program = compile(environment(Object.keys(context)), source.success, 'json');
		if ('error' in program) throw new Refusal({ message: program.error });
		return evaluate(program, context);
	};
}
let configuredNestedDepth = 0;
/**
 * The nested `configured_eval` failures of the strict evaluation running now, kept even when CEL's commutative
 * `&&` / `||` absorbs them (`error && false` is false): a record's broken expression never reads as a quiet no.
 */
let failures:
	| {
			readonly expression: string;
			readonly message: string;
	  }[]
	| undefined;
/** The node a failed lookup names: a field access (`.`), or an index (`[]`) whose key is its `right` operand. */
const Span = Schema.Struct({ start: Schema.Number, end: Schema.Number });
const FailedLookup = Schema.Struct({ ...Span.fields, op: Schema.String, right: Schema.Unknown });
/**
 * A failed evaluation as an operator reads it: a lookup that found nothing names the setting as the formula reads it
 * (`company.facts.leave_cash_out_day_divisor` missing, `company.risk_class` blank), else the evaluator's own message.
 */
export const failureMessage = (expression: string, cause: unknown): string => {
	const message = getErrorMessage(cause);
	if (!message.startsWith('No such key:') || !(cause instanceof Error)) return message;
	const node = Schema.decodeUnknownOption(FailedLookup)(Reflect.get(cause, 'node'));
	if (node._tag === 'None') return message;
	const span =
		node.value.op === '[]' && Schema.is(Span)(node.value.right) ? node.value.right : node.value;
	return `the setting ${expression.slice(span.start, span.end)} is missing or blank.`;
};
/** A record's own stored expression, evaluated from another (the encash rule reads `leave_catalog.entitlement.days`). */
registrations.push([
	'configured_eval(string, map): dyn',
	(expression: unknown, context: unknown) => {
		if (!Predicate.isString(expression) || !isDynObject(context))
			throw new Refusal({
				message: 'Configured evaluation requires an expression and its captured record.'
			});
		if (configuredNestedDepth >= 16)
			throw new Refusal({ message: 'Configured evaluation exceeds its nested expression limit.' });
		configuredNestedDepth++;
		const evaluated = Result.try(() => configuredProgram(expression)(context));
		configuredNestedDepth--;
		if (Result.isFailure(evaluated)) {
			failures?.push({ expression, message: failureMessage(expression, evaluated.failure) });
			throw evaluated.failure;
		}
		return evaluated.success;
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
	const mine: {
		readonly expression: string;
		readonly message: string;
	}[] = [];
	failures = mine;
	const evaluated = Result.try(() => evaluateConfigured(expression, context));
	failures = outer;
	if (Result.isFailure(evaluated))
		mine.push({ expression, message: failureMessage(expression, evaluated.failure) });
	const value = Result.isSuccess(evaluated) ? evaluated.success : null;
	const [first] = mine;
	if (first !== undefined) throw new Refusal({ message: first.message, detail: first.expression });
	return value;
};
