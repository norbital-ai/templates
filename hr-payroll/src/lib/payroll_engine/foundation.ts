import { Data, Effect, Schema } from 'effect';
import type { ReadField, ReadableName, Row, WorkspaceQuery } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';
import { addMonths, datePeriod, days, isPlainDate, monthOf } from '@norbital-ai/std/date';
import { decimal } from './money.js';
export type Json = Schema.Json;
export type JsonObject = { readonly [key: string]: Json };
export type DynObject = Record<string, unknown>;
export const jsonObject = (value: unknown): JsonObject =>
	Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(jsonValues(value));
export const isJsonObject = (v: unknown): v is JsonObject =>
	v !== null && typeof v === 'object' && !Array.isArray(v);
export const isDynObject = (v: unknown): v is DynObject =>
	v !== null && typeof v === 'object' && !Array.isArray(v);
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
export type HostRead = WorkspaceQuery['query'];
export const exactDecimal = decimal;
export const numberOf = (value: unknown): number | null =>
	value instanceof Decimal
		? value.toNumber()
		: typeof value === 'number' && Number.isFinite(value)
			? value
			: typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
				? Number(value)
				: null;
export const moneyNumber = numberOf;
export const jsonValues = (value: unknown): unknown =>
	value instanceof Decimal
		? value.toNumber()
		: Array.isArray(value)
			? value.map(jsonValues)
			: isDynObject(value)
				? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonValues(v)]))
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
export const dateKey = (value: unknown): string => {
	const v = String(value);
	if (!isPlainDate(v)) throw new Refusal({ message: 'An actual ISO date is required.' });
	return v;
};
export const calendarDateInTimeZone = (instant: Date, timezone: string): string =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);
export const completedMonths = (from: string, to: string): number => {
	let n =
		(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
		Number(to.slice(5, 7)) -
		Number(from.slice(5, 7));
	if (String(addMonths(from, n)) > to) n--;
	return n;
};
export const formatNamedList = (items: readonly string[]): string => items.join(', ');
export const requireCompletePages = (
	pages: Readonly<Record<string, { readonly next?: string | null }>>,
	label: string
): Effect.Effect<void, Refusal> =>
	Object.values(pages).some((p) => p.next != null)
		? Effect.fail(
				new Refusal({ message: `${label}: complete the bounded read before calculation.` })
			)
		: Effect.void;
export const isExitTag = (value: unknown, contractId?: string): boolean =>
	isDynObject(value) &&
	value.kind === 'EXIT' &&
	(contractId === undefined || value.employment_id === contractId);

export const decodeNumber = (value: unknown): number => {
	const result = numberOf(value);
	if (result === null) throw new Refusal({ message: 'An actual finite number is required.' });
	return result;
};
