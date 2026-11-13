import { BigDecimal, Data, DateTime, Duration, Schema } from 'effect';
export type Json = Schema.Json;
export type JsonObject = { readonly [key: string]: Json };
export type DynObject = Record<string, unknown>;
export const jsonObject = (value: unknown): JsonObject =>
	Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(jsonValues(value));
export const isJsonObject = (v: unknown): v is JsonObject =>
	v !== null && typeof v === 'object' && !Array.isArray(v);
export const isDynObject = (v: unknown): v is DynObject =>
	v !== null && typeof v === 'object' && !Array.isArray(v) && !BigDecimal.isBigDecimal(v);
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
const DECIMAL_FIELDS = new Set([
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
]);
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
export const jsonValues = (value: unknown): unknown =>
	BigDecimal.isBigDecimal(value)
		? BigDecimal.toNumberUnsafe(value)
		: Array.isArray(value)
			? value.map(jsonValues)
			: isDynObject(value)
				? Object.fromEntries(
						Object.entries(value).map(([k, v]) => [
							k,
							DECIMAL_FIELDS.has(k) && typeof v === 'string' && DECIMAL_TEXT.test(v)
								? Number(v)
								: jsonValues(v)
						])
					)
				: value;
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
export const completedMonths = (from: string, to: string): number => {
	let n =
		(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
		Number(to.slice(5, 7)) -
		Number(from.slice(5, 7));
	if (DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(from), { months: n })) > to) n--;
	return n;
};

export const decodeNumber = (value: unknown): number => {
	const result = numberOf(value);
	if (result === null) throw new Refusal({ message: 'An actual finite number is required.' });
	return result;
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
