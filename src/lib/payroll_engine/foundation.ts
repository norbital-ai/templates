import { Context, Data, Effect, Schema } from 'effect';
import type { CollectionName } from '@norbital-ai/bolt';

/** One refused operation with its actual original reason; every engine failure is this one error. */
export class Refusal extends Data.TaggedError('Refusal')<{ readonly message: string; readonly detail?: string }> {}

export const refuse = (message: string, detail?: string): Effect.Effect<never, Refusal> =>
	Effect.fail(new Refusal({ message, ...(detail === undefined ? {} : { detail }) }));

/** The record reader the engine runs against: the workspace in production, a fixture in probes. */
export type ReadsShape = {
	readonly read: (
		collection: CollectionName,
		query: unknown
	) => Effect.Effect<{ readonly rows: readonly unknown[] }, unknown>;
};

export class Reads extends Context.Tag('payroll/Reads')<Reads, ReadsShape>() {}

/** A row as its stored JSON: identity and dates are plain values, never class instances. */
export const plain = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T;

export const plainRows = <T>(rows: readonly unknown[]): T[] => plain(rows as T[]);

/** A stored numeric as its actual number. */
export const decodeNumber = (value: unknown): number => {
	if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return value;
	const parsed = Schema.is(Schema.Union(Schema.Number, Schema.String))(value) ? Number(value) : Number.NaN;
	if (Number.isFinite(parsed) && String(value).trim() !== '') return parsed;
	return refuse('A stored numeric requires its actual finite value.') as never;
};

/** Deterministic JSON for hashing and comparison: object keys in sorted order. */
export const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));

const sortValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortValue);
	if (Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value)) {
		const source = value as Record<string, unknown>;
		return Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortValue(source[key])]));
	}
	return value;
};

const matchesNothing = (where: object): boolean =>
	Object.values(where).some((clause) => {
		if (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(clause)) return false;
		const inList = (clause as { in?: unknown }).in;
		return Array.isArray(inList) && inList.length === 0;
	});

/** Collections whose rows outgrow one crossing answer; page them. */
const WIDE_ROWS: Partial<Record<CollectionName, number>> = {
	payroll_runs: 1,
	payslips: 200,
	leave_entries: 1000,
	work_days: 1000
};

/** Every row of `collection` matching `where`, whole; paged where rows are too large. */
export const readAll = Effect.fn('payroll.readAll')(function* <T>(
	collection: CollectionName,
	where: object,
	page?: number,
	narrowed?: object
): Generator<never, T[], Refusal> {
	const reads = (yield* Effect.serviceOption(Reads)) as ReadsShape | undefined;
	if (reads === undefined) return [];
	if (matchesNothing(where)) return [];
	const select = narrowed;
	page ??= select === undefined ? WIDE_ROWS[collection] : undefined;
	if (page === undefined) {
		const answer = yield* Effect.tryPromise({
			try: () => reads.read(collection, { where, select, all: true }),
			catch: (cause) => new Refusal({ message: 'A whole-row read failed.', detail: String(cause) })
		});
		return plainRows<T>(answer.rows);
	}
	const rows: T[] = [];
	let after: unknown = null;
	do {
		const answer = yield* Effect.tryPromise({
			try: () => reads.read(collection, { where, select, page, after }),
			catch: (cause) => new Refusal({ message: 'A paged read failed.', detail: String(cause) })
		});
		rows.push(...plainRows<T>(answer.rows));
		after = (answer as { after?: unknown }).after ?? null;
	} while (after != null);
	return rows;
});

/** One read memo per query within an effect's scope. */
export const memoizedReads = Effect.acquireRelease(
	Effect.sync(() => new Map<string, Effect.Effect<{ readonly rows: readonly unknown[] }, unknown>>()),
	(cache) => Effect.sync(() => cache.clear())
).pipe(
	Effect.map((cache): ReadsShape => ({
		read: (collection, query) => {
			const key = `${String(collection)}\u0000${stableJson(query)}`;
			const held = cache.get(key);
			if (held !== undefined) return held;
			const read = Effect.serviceOption(Reads).pipe(
				Effect.flatMap((reads) =>
					reads._tag === 'None'
						? Effect.sync(() => ({ rows: [] as readonly unknown[] }))
						: reads.value.read(collection, query)
				)
			);
			cache.set(key, read);
			return read;
		}
	}))
);

export const PAYROLL_TIME_ZONE = 'UTC';

/** An actual `YYYY-MM-DD` calendar date. */
export const isCalendarDate = (value: unknown): value is string => {
	if (!Schema.is(Schema.String)(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const stamp = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === value;
};

export const dateKey = (value: unknown): string =>
	isCalendarDate(value) ? value : (refuse('A stored date requires its actual calendar day.') as never);

export const calendarDateInTimeZone = (instant: Date, timezone: string): string =>
	new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

export const calendarDay = (value: unknown): { year: number; month: number; day: number } => {
	const day = dateKey(value);
	return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) };
};

export const isClockTime = (value: unknown): value is string =>
	Schema.is(Schema.String)(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const isOffsetIsoInstant = (value: unknown): value is string =>
	Schema.is(Schema.String)(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);

export const formatDateISO = (date: Date): string => date.toISOString().slice(0, 10);

/** One error's actual message. */
export const getErrorMessage = (value: unknown): string => (value instanceof Error ? value.message : String(value));
