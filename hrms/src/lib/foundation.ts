import { BigDecimal, Data, DateTime, Duration, Schema } from 'effect';
export type Json = Schema.Json;
export type JsonObject = { readonly [key: string]: Json };
export type DynObject = Record<string, unknown>;
const decodeJsonObject = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
export const jsonObject = (value: unknown): JsonObject => decodeJsonObject(jsonValues(value));
export const isJsonObject = (v: unknown): v is JsonObject =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
export const isDynObject = (v: unknown): v is DynObject =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && !BigDecimal.isBigDecimal(v);
/** Leave is stored as dated half-day slots; quantity is derived, never stored. */
export const leaveDays = (entry: JsonObject): number => {
	const days = entry.days;
	return Array.isArray(days) ? days.length / 2 : 0;
};

/** Leave entries present the derived half-day quantity to catalogue expressions. */
export const leaveEntry = (entry: JsonObject): JsonObject =>
	entry.days === undefined ? entry : { ...entry, quantity: leaveDays(entry), unit: 'DAY' };

export class Refusal extends Data.TaggedError('Refusal')<{
	readonly message: string;
	readonly detail?: string | undefined;
}> {}
export const numberOf = (value: unknown): number | null =>
	BigDecimal.isBigDecimal(value)
		? BigDecimal.toNumberUnsafe(value)
		: typeof value === 'number' && Number.isFinite(value)
			? value
			: typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
				? Number(value)
				: null;
// a model's decimal field reads as its exact text; the engine computes on numbers
const DECIMAL_FACTS = [
	'amount',
	'quantity',
	'recovered',
	'basic_earnings',
	'gross_earnings',
	'net_pay',
	'total_deductions',
	'employer_cost',
	'ordinary_wages',
	'employee_statutory',
	'tax_withheld'
] as const;
const DECIMAL_FIELDS = new Set<string>(DECIMAL_FACTS);
// only a column typed as text is a decimal's exact text; a JSON value under the same name stays what it is
type Fact<V> = [V] extends [string | null | undefined]
	? V extends string
		? number
		: V
	: Calculated<V>;
/** A read row as the calculation holds it (`jsonValues`): the model's own row, its decimal facts as numbers. */
export type Calculated<T> = T extends string | number | boolean | null | undefined
	? T
	: T extends readonly (infer Item)[]
		? readonly Calculated<Item>[]
		: T extends object
			? {
					readonly [K in keyof T]: K extends (typeof DECIMAL_FACTS)[number]
						? Fact<T[K]>
						: Calculated<T[K]>;
				}
			: T;
/** Whether `row`'s own decimal facts are numbers: all that sets the calculation's copy of a row apart from the row. */
const factsAreNumbers = (row: unknown): boolean =>
	!isDynObject(row) ||
	Object.entries(row).every(
		([k, v]) => !DECIMAL_FIELDS.has(k) || typeof v !== 'string' || !DECIMAL_TEXT.test(v)
	);
/** A read's roots as the calculation holds them: each root's rows typed as its read layer, decimal facts as numbers. */
export type CalculatedRoots<Answer> = {
	readonly [C in keyof Answer]: Answer[C] extends { readonly rows: infer Rows }
		? Calculated<Rows>
		: never;
};
/**
 * `copies` are the calculation's copies of `pages`' rows, root by root, checked: their decimal facts are numbers, and
 * nothing else in a copy differs from its row.
 */
export const calculated = <Answer>(
	copies: unknown,
	_pages: Answer
): copies is CalculatedRoots<Answer> =>
	isDynObject(copies) &&
	Object.values(copies).every((rows) => Array.isArray(rows) && rows.every(factsAreNumbers));
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
export const jsonValues = (value: unknown): unknown => {
	if (typeof value !== 'object' || value === null) return value;
	if (BigDecimal.isBigDecimal(value)) return BigDecimal.toNumberUnsafe(value);
	if (Array.isArray(value)) {
		let copy: unknown[] | undefined;
		for (let i = 0; i < value.length; i++) {
			const item = value[i];
			const next = jsonValues(item);
			if (next !== item) {
				if (copy === undefined) copy = value.slice(0, i);
				copy.push(next);
			} else if (copy !== undefined) {
				copy.push(item);
			}
		}
		return copy ?? value;
	}
	if (!isDynObject(value)) return value;
	let copy: Record<string, unknown> | undefined;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		const item = value[key];
		const next =
			DECIMAL_FIELDS.has(key) && typeof item === 'string' && DECIMAL_TEXT.test(item)
				? Number(item)
				: jsonValues(item);
		if (next !== item) {
			if (copy === undefined) {
				copy = {};
				for (const prev in value) {
					if (prev === key) break;
					if (Object.hasOwn(value, prev)) copy[prev] = value[prev];
				}
			}
			copy[key] = next;
		} else if (copy !== undefined) {
			copy[key] = item;
		}
	}
	return copy ?? value;
};
export const stableJson = (value: unknown): string => JSON.stringify(sortValue(jsonValues(value)));
const sortValue = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(sortValue)
		: isDynObject(value)
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((k) => [k, sortValue(value[k])])
				)
			: value;
export const getErrorMessage = (error: unknown): string =>
	error instanceof Error
		? error.message
		: isDynObject(error) && typeof error.message === 'string'
			? error.message
			: String(error);
const daysInCalendarMonth = (year: number, month: number): number =>
	new Date(Date.UTC(year, month, 0)).getUTCDate();

const validDates = new Map<string, number>();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Validates an ISO calendar date (`YYYY-MM-DD`) and returns its UTC epoch milliseconds, or `undefined` if invalid. */
export const isoDateMillis = (value: string): number | undefined => {
	const held = validDates.get(value);
	if (held !== undefined) return held;
	if (!ISO_DATE.test(value)) return undefined;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	const day = Number(value.slice(8, 10));
	if (month < 1 || month > 12 || day < 1 || day > daysInCalendarMonth(year, month))
		return undefined;
	const ms = Date.UTC(year, month - 1, day);
	if (validDates.size >= 4096) validDates.clear();
	validDates.set(value, ms);
	return ms;
};
export const isIsoDate = (value: string): boolean => isoDateMillis(value) !== undefined;
export const monthEndOf = (ym: string): string => {
	const last = daysInCalendarMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
	return `${ym}-${String(last).padStart(2, '0')}`;
};
export const addDays = (day: string, days: number): string =>
	DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { days }));
export const completedMonths = (from: string, to: string): number => {
	const fromY = Number(from.slice(0, 4));
	const fromM = Number(from.slice(5, 7));
	const fromD = Number(from.slice(8, 10));
	const toY = Number(to.slice(0, 4));
	const toM = Number(to.slice(5, 7));
	const toD = Number(to.slice(8, 10));
	let n = (toY - fromY) * 12 + toM - fromM;
	if (fromD > toD && Math.min(fromD, daysInCalendarMonth(toY, toM)) > toD) n--;
	return n;
};

// everyone a run prices shares the same periods: each list of days is worked out once
const dayLists = new Map<string, readonly string[]>();
/** Every calendar day from `from` to `to`, both included. */
export const daysIn = (from: string, to: string): readonly string[] => {
	const key = `${from}/${to}`;
	const held = dayLists.get(key);
	if (held !== undefined) return held;
	if (to < from) throw new RangeError(`period ends (${to}) before it starts (${from})`);
	const start = DateTime.makeUnsafe(from);
	const days = Array.from(
		{ length: Duration.toDays(DateTime.distance(start, DateTime.makeUnsafe(to))) + 1 },
		(_, i) => DateTime.formatIsoDate(DateTime.add(start, { days: i }))
	);
	if (dayLists.size >= 2_000) dayLists.clear();
	dayLists.set(key, days);
	return days;
};
