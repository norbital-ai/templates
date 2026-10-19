import { Predicate } from 'effect';
import { Context, Data, Effect, Result, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { addDays, datePeriod, eachDay, isPlainDate, monthOf } from '@norbital-ai/std/date';
import {
	isMasked,
	type CallerReads,
	type Cursor,
	type DeclaredQuery,
	type DeclaredRow,
	type Masked,
	type Page,
	type Paged,
	type QueryCtx,
	type ReadableName,
	type ReadMember,
	type ReadSet,
	type ReadSetAnswer,
	type Row,
	type Select,
	type StoredAnswer,
	type StoredMember,
	type WorkspaceReads,
	type Where
} from '@norbital-ai/bolt';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
export type { ReadableName } from '@norbital-ai/bolt';
/** Stored JSON, bounded once: a value the engine reads is one of these, never a free-form record. */
export type Json = Schema.Json;
export type JsonObject = {
	readonly [key: string]: Json;
};
/** An evaluated CEL value before normalisation: integers arrive as bigint. */
export type DynObject = {
	[key: string]: DynValue;
};
type DynValue = Json | bigint | DynObject;
const DynRecord = Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.BigInt]));
export const isDynObject: (value: unknown) => value is DynObject = Schema.is(DynRecord);
export const isJsonObject: (value: unknown) => value is JsonObject = Schema.is(
	Schema.Record(Schema.String, Schema.Json)
);
const isCelObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
/** One refused operation with its actual original reason; every engine failure is this one error. */
export class Refusal extends Data.TaggedError('Refusal')<{
	readonly message: string;
	readonly detail?: string | undefined;
}> {}
export const refuse = (message: string, detail?: string): Effect.Effect<never, Refusal> =>
	Effect.fail(new Refusal({ message, ...(detail === undefined ? {} : { detail }) }));
/** A required native field stays unavailable until the caller's actual read admits it. */
export const fieldValue = <A>(value: A | Masked, field: string): Result.Result<A, Refusal> =>
	isMasked(value)
		? Result.fail(new Refusal({ message: `This operation needs access to ${field}.` }))
		: Result.succeed(value);
/** Native readers retain Bolt's actual collection, projection and keyed-answer types. */
export type HostRead = WorkspaceReads['read'];
export type CallerRead = CallerReads<ReadFailed>['read'];
export type HostRow<C extends ReadableName> = Row<C>;
export type StoredSelect<C extends ReadableName> = NonNullable<
	Extract<StoredMember<C>, { readonly all: true }>['select']
>;
declare const nativeRead: HostRead;
declare const nativeCallerRead: CallerRead;
export type StoredWhere<C extends ReadableName> = NonNullable<
	Parameters<typeof nativeRead<C, {}>>[1]['where']
>;
type ReadRow<C extends ReadableName, S extends StoredSelect<C> & Select<C>> =
	| Effect.Success<ReturnType<typeof nativeRead<C, S>>>['rows'][number]
	| Effect.Success<ReturnType<typeof nativeCallerRead<C, S>>>['rows'][number];
/** Both native readers admit these inputs; each answer retains its native projections and caller masks. */
export interface Read<E = ReadFailed> {
	<C extends ReadableName>(
		collection: C,
		query: DeclaredQuery
	): Effect.Effect<Page<DeclaredRow<C>>, ReadFailed>;
	<C extends ReadableName, const S extends StoredSelect<C> & Select<C> = {}>(
		collection: C,
		query: { where?: NoInfer<StoredWhere<C> & Where<C>>; select?: S } & Paged
	): Effect.Effect<Page<ReadRow<C, S>>, E>;
	<const M extends ReadSet>(
		set: M & {
			readonly [K in keyof M]: StoredMember<M[K]['collection']> & ReadMember<M[K]['collection']>;
		}
	): Effect.Effect<{ readonly [K in keyof M]: StoredAnswer<M[K]> } | ReadSetAnswer<M>, E>;
}
export type ReadError = Refusal | ReadFailed;
type ReadsShape = { readonly read: Read };
export class Reads extends Context.Service<Reads, ReadsShape>()('payroll/Reads') {}
export const readsFrom = (read: HostRead | CallerRead | Read): ReadsShape => ({ read });
/** Concurrent native reads share the guest crossing; refusal selection follows the input order. */
export const eachBatched = Effect.fnUntraced(function* <I, O, E, R, Reader extends Read>(
	inputs: readonly I[],
	read: Reader,
	walk: (input: I, index: number, read: Reader) => Effect.Effect<O, E, R>
) {
	const settled = yield* Effect.forEach(
		inputs,
		(input, index) => Effect.result(walk(input, index, read)),
		{ concurrency: 'unbounded' }
	);
	const values: O[] = [];
	for (const outcome of settled) {
		if (Result.isFailure(outcome)) return yield* Effect.fail(outcome.failure);
		values.push(outcome.success);
	}
	return values;
});
/** A guest engine computation stays inside its caller's Effect, including authored refusal. */
export const runEngine = <A>(
	effect: Effect.Effect<A, ReadError, Reads>,
	read: Read,
	refuse: QueryCtx['refuse']
) =>
	effect.pipe(
		Effect.provideService(Reads, readsFrom(read)),
		Effect.catchTag('Refusal', (failure) => refuse(failure.message))
	);
/** A stored numeric as its actual number. */
export const decodeNumber = (value: unknown): number =>
	numberOf(value) ?? refuseNow('A stored numeric requires its actual finite value.');
/** A stored number or numeric string as its finite value, or null. */
export const numberOf = (candidate: unknown): number | null => {
	if (candidate instanceof Decimal) return candidate.toNumber();
	if (Schema.is(Schema.Number)(candidate)) return Number.isFinite(candidate) ? candidate : null;
	if (!Predicate.isString(candidate) || candidate.trim() === '') return null;
	const parsed = Number(candidate);
	return Number.isFinite(parsed) ? parsed : null;
};
/** A money column after the native wire decoder: its Decimal amount, or null. */
export const moneyNumber = (value: unknown): number | null =>
	value instanceof Decimal ? value.toNumber() : null;

/** A host row's values as CEL reads them: a stored decimal is its number, everything else as it came. */
export const celValues = (value: unknown): unknown => {
	if (value instanceof Decimal) return Number(value.toString());
	if (Array.isArray(value)) return value.map(celValues);
	if (isCelObject(value))
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, celValues(entry)]));
	return value;
};
/** Deterministic JSON for hashing and comparison: object keys in sorted order. */
export const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));
/** The prior values of the fields an update changes (`before`, stored by the transform for the row taps). */
export const beforeOf = (
	existing: object | undefined,
	input: object
): {
	[field: string]: Json;
} => {
	const held: Readonly<Record<string, unknown>> = { ...existing };
	const out: {
		[field: string]: Json;
	} = {};
	for (const [field, value] of Object.entries(input))
		if (field !== 'before' && field !== 'id' && stableJson(held[field]) !== stableJson(value)) {
			const prior = celValues(held[field] ?? null);
			out[field] = Schema.is(Schema.Json)(prior) ? prior : null;
		}
	return out;
};
const sortValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortValue);
	if (isJsonObject(value))
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, sortValue(entry)])
		);
	return value;
};
/** Collections whose rows outgrow one crossing answer; page them. */
const WIDE_ROWS: Partial<Record<ReadableName, number>> = {
	payroll_run: 1,
	payslip: 200,
	leave_catalog_entry: 1000,
	roster_entry: 1000
};
/** Native stored or caller projections, with native cursors for large rows. */
const readPages = Effect.fnUntraced(function* <A, E>(
	readPage: (paging: Paged) => Effect.Effect<Page<A>, E>,
	page: number | undefined
) {
	if (page === undefined) return (yield* readPage({ all: true })).rows;
	const first = yield* readPage({ limit: page });
	const rows = [...first.rows];
	let after: Cursor | null = first.next;
	while (after !== null) {
		const answer = yield* readPage({ limit: page, after });
		rows.push(...answer.rows);
		after = answer.next;
	}
	return rows;
});
export const readAll = <C extends ReadableName, const S extends StoredSelect<C> & Select<C> = {}>(
	collection: C,
	where: StoredWhere<C> & Where<C>,
	page?: number,
	select?: S
): Effect.Effect<readonly ReadRow<C, S>[], ReadFailed, Reads> =>
	Effect.flatMap(Reads, ({ read }) => {
		const readPage = read<C, S>;
		const query: { where: StoredWhere<C> & Where<C>; select?: S } = {
			where,
			...(select === undefined ? {} : { select })
		};
		return readPages<ReadRow<C, S>, ReadFailed>(
			(paging) => readPage(collection, { ...query, ...paging }),
			page ?? (select === undefined ? WIDE_ROWS[collection] : undefined)
		);
	});
export const PAYROLL_TIME_ZONE = 'UTC';
/** An actual `YYYY-MM-DD` calendar date. */
export const isCalendarDate = isPlainDate;
/** One refused value: the engine's single error, thrown where no Effect channel exists. */
const refuseNow = (message: string, detail?: string): never => {
	throw new Refusal({ message, ...(detail === undefined ? {} : { detail }) });
};
export const dateKey = (value: unknown): string =>
	isCalendarDate(value) ? value : refuseNow('A stored date requires its actual calendar day.');
export const calendarDateInTimeZone = (instant: Date, timezone: string): string =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);
export const formatNamedList = (items: readonly string[]): string =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const isYearMonth = (value: unknown): value is string =>
	Predicate.isString(value) && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const monthEnd = (month: string): string => String(monthOf(`${month}-01`).to);
/** Whole calendar months from `from` to `to`: a month completes on the same day-of-month. */
export const completedMonths = (from: string, to: string): number =>
	(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
	(Number(to.slice(5, 7)) - Number(from.slice(5, 7))) -
	(to.slice(8, 10) >= from.slice(8, 10) ? 0 : 1);
/** The salary period one period key names. */
export const payPeriodWindow = (
	period: string,
	options: {
		readonly pay_frequency?: string;
		readonly pay_cutoff_day?: number;
		/** The version's `payroll.week_start` (0 = Sunday … 6 = Saturday; default Sunday). */
		readonly week_start?: number;
		/** The version's `payroll.semi_monthly_split`: the first half's last day (default 15). */
		readonly semi_monthly_split?: number;
	}
): {
	readonly start: string;
	readonly end: string;
} => {
	const month = period.slice(0, 7);
	if (!isYearMonth(month)) refuseNow('A pay period requires its actual calendar month.');
	const frequency = options.pay_frequency ?? 'MONTHLY';
	if (frequency === 'MONTHLY' || frequency === 'INTEGER_MONTHS')
		return { start: `${month}-01`, end: monthEnd(month) };
	if (frequency === 'SEMI_MONTHLY') {
		const half = period.slice(8, 9) === '2' ? 2 : 1;
		const split = String(Math.min(27, Math.max(1, options.semi_monthly_split ?? 15))).padStart(
			2,
			'0'
		);
		return half === 1
			? { start: `${month}-01`, end: `${month}-${split}` }
			: { start: addDays(`${month}-${split}`, 1), end: monthEnd(month) };
	}
	if (frequency === 'TEN_DAY') {
		const part = Number(period.slice(8, 9) || '1');
		if (part === 1) return { start: `${month}-01`, end: `${month}-10` };
		if (part === 2) return { start: `${month}-11`, end: `${month}-20` };
		return { start: `${month}-21`, end: monthEnd(month) };
	}
	if (frequency === 'WEEKLY') {
		const start = weeklyInstalments(month, options.week_start)[Number(period.slice(8)) - 1];
		if (start == null) return refuseNow(`Pay period ${period} names no week of its month.`);
		return { start, end: addDays(start, 6) };
	}
	if (frequency === 'DAILY') {
		if (!isCalendarDate(period))
			return refuseNow('A daily pay period requires its actual calendar day.');
		return { start: period, end: period };
	}
	return refuseNow(`Pay period ${frequency} requires its own calendar.`);
};
/** A switch of pay frequency: from this day the entity pays at `frequency`. */
export type FrequencyChange = {
	readonly from: string;
	readonly frequency: string;
};
type Paying = {
	readonly pay_frequency?: string | null;
	readonly pay_frequency_changes?: readonly FrequencyChange[] | null;
};
const changesOf = (entity: Paying): readonly FrequencyChange[] =>
	(entity.pay_frequency_changes ?? []).toSorted((a, b) => a.from.localeCompare(b.from));
/** The frequency in force on a day: the latest switch on or before it, else the entity's own. */
export const frequencyOn = (entity: Paying, day: string): string =>
	changesOf(entity)
		.filter((change) => change.from <= day)
		.at(-1)?.frequency ??
	entity.pay_frequency ??
	'MONTHLY';
/** A month's days cut by the frequency in force: contiguous spans, first to last. */
export const frequencySpans = (
	entity: Paying,
	month: string
): readonly {
	readonly frequency: string;
	readonly from: string;
	readonly to: string;
}[] => {
	const spans: {
		frequency: string;
		from: string;
		to: string;
	}[] = [];
	for (const day of eachDay(monthOf(`${month}-01`))) {
		const frequency = frequencyOn(entity, day);
		const last = spans.at(-1);
		if (last?.frequency === frequency) last.to = day;
		else spans.push({ frequency, from: day, to: day });
	}
	return spans;
};
/**
 * The period keys a month offers under the frequencies in force in it, each with its window cut to the days its
 * frequency pays: a switch inside the month leaves each frequency only its own days.
 */
export const periodsIn = (
	entity: Paying,
	month: string,
	options: {
		readonly week_start?: number;
		readonly semi_monthly_split?: number;
	} = {}
): readonly {
	readonly key: string;
	readonly frequency: string;
	readonly from: string;
	readonly to: string;
}[] =>
	frequencySpans(entity, month).flatMap((span) => {
		const keys =
			span.frequency === 'MONTHLY' || span.frequency === 'INTEGER_MONTHS'
				? [month]
				: span.frequency === 'SEMI_MONTHLY'
					? [`${month}-1`, `${month}-2`]
					: span.frequency === 'TEN_DAY'
						? [`${month}-1`, `${month}-2`, `${month}-3`]
						: span.frequency === 'WEEKLY'
							? weeklyInstalments(month, options.week_start).map((_, i) => `${month}-${i + 1}`)
							: [];
		const days = span.frequency === 'DAILY' ? eachDay(datePeriod(span.from, span.to)) : keys;
		return days.flatMap((key) => {
			const window = payPeriodWindow(key, { ...options, pay_frequency: span.frequency });
			const from = window.start > span.from ? window.start : span.from;
			const to = window.end < span.to || span.frequency === 'WEEKLY' ? window.end : span.to;
			return from > to ? [] : [{ key, frequency: span.frequency, from, to }];
		});
	});
/** The weekly instalments a month holds: the days inside it that start a week (`weekStart`, default Sunday = 0). */
export const weeklyInstalments = (period: string, weekStart = 0): readonly string[] => {
	const month = period.slice(0, 7);
	const weeks: string[] = [];
	for (const day of eachDay(monthOf(`${month}-01`)))
		if (new Date(`${day}T00:00:00Z`).getUTCDay() === weekStart) weeks.push(day);
	return weeks;
};
/** One error's actual message. */
export const getErrorMessage = (value: unknown): string =>
	value instanceof Error ? value.message : String(value); // repository-health:allow STD2 -- this is the owner of that rule: the one place an unknown throw becomes text.
