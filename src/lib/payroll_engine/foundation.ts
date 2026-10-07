import { Context, Data, Effect, Result, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { monthOf } from '@norbital-ai/std/date';
import type { CollectionName, Id, QueryCtx, Row, TransformCtx } from '@norbital-ai/bolt';

/** Stored JSON, bounded once: a value the engine reads is one of these, never a free-form record. */
export type Json = Schema.Json;
export type JsonObject = { readonly [key: string]: Json };
/** An evaluated CEL value before normalisation: integers arrive as bigint. */
export type DynObject = { [key: string]: DynValue };
export type DynValue = Json | bigint | DynObject;
const DynRecord = Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.BigInt]));
export const isDynObject = (value: unknown): value is DynObject => Schema.is(DynRecord)(value);
export const isJsonObject = (value: unknown): value is JsonObject =>
	Schema.is(Schema.Record(Schema.String, Schema.Json))(value);

/** One refused operation with its actual original reason; every engine failure is this one error. */
export class Refusal extends Data.TaggedError('Refusal')<{
	readonly message: string;
	readonly detail?: string;
}> {}

export const refuse = (message: string, detail?: string): Effect.Effect<never, Refusal> =>
	Effect.fail(new Refusal({ message, ...(detail === undefined ? {} : { detail }) }));

/** Bolt's `read` names: authored and system collections except ledgers (`sys_run`, `sys_event`). */
export type ReadableName = Exclude<CollectionName, 'sys_run' | 'sys_event'>;

export type HostRow<C extends ReadableName> = Partial<Row<C>> & { readonly id: Id<C> };

/** The record reader the engine runs against: the workspace in production, a fixture in probes. */
export type ReadsShape = {
	readonly read: (
		collection: ReadableName,
		query: {
			readonly where?: object;
			readonly select?: object;
			readonly all?: boolean;
			readonly page?: number;
			readonly after?: unknown;
		}
	) => Effect.Effect<{ readonly rows: readonly unknown[]; readonly after?: unknown }, Refusal>;
};

export class Reads extends Context.Service<Reads, ReadsShape>()('payroll/Reads') {}

/** One host read the engine or behaviours issue: collection name plus a plain query object. */
export type HostReadQuery = {
	readonly where?: object;
	readonly select?: object;
	readonly all?: boolean;
	readonly limit?: number;
	readonly after?: unknown;
};

/** A host's reader: a transform's `ctx.db.read` or an automation's `ctx.read`. */
export type HostRead = <C extends ReadableName>(
	collection: C,
	query: HostReadQuery
) => Promise<{ readonly rows: readonly HostRow<C>[]; readonly next?: unknown }>;

type BoltWorkspaceRead = TransformCtx<string>['db']['read'];
type BoltCallerRead = QueryCtx['read'];

type HostPage = {
	readonly rows: readonly unknown[];
	readonly next?: unknown | null;
};

/** Bolt's typed `read` is generic over `Where<C>`; a shared engine query cannot prove that. */
type LooseRead = (collection: string, query: HostReadQuery) => Promise<HostPage>;

const hostReadPage = <C extends ReadableName>(
	page: HostPage
): {
	readonly rows: readonly HostRow<C>[];
	readonly next?: unknown;
} => ({
	rows: page.rows as HostRow<C>[],
	...(page.next == null ? {} : { next: page.next })
});

/** A transform's `ctx.db.read` as {@link HostRead}. */
export const workspaceReadAsHost =
	(read: BoltWorkspaceRead | HostRead): HostRead =>
	<C extends ReadableName>(collection: C, query: HostReadQuery) =>
		(read as LooseRead)(collection, query).then((page) => hostReadPage<C>(page));

/** An automation or action's `ctx.read` as {@link HostRead}. */
export const callerReadAsHost =
	(read: BoltCallerRead): HostRead =>
	<C extends ReadableName>(collection: C, query: HostReadQuery) =>
		(read as LooseRead)(collection, query).then((page) => hostReadPage<C>(page));

/** The engine's reads over one host reader: whole reads stay whole, paged reads carry the host's cursor. */
export const readsFrom = (read: HostRead | BoltWorkspaceRead): ReadsShape => {
	const hostRead = workspaceReadAsHost(read);
	return {
		read: (collection, query) =>
			Effect.tryPromise({
				try: async () => {
					const answer = await hostRead(collection, {
						...(query.where == null ? {} : { where: query.where }),
						...(query.select == null ? {} : { select: query.select }),
						...(query.all === true
							? { all: true as const }
							: {
									limit: query.page ?? 200,
									...(query.after == null ? {} : { after: query.after })
								})
					});
					return { rows: answer.rows, after: answer.next };
				},
				catch: (cause) => new Refusal({ message: 'A read failed.', detail: String(cause) })
			})
	};
};

/** Run one engine effect against a host reader; a refusal comes back as the host's own refusal. */
export const runEngine = async <A>(
	effect: Effect.Effect<A, Refusal, Reads>,
	read: HostRead | BoltWorkspaceRead,
	refuse: (message: string) => never
): Promise<A> => {
	const outcome = await Effect.runPromise(
		Effect.result(effect.pipe(Effect.provideService(Reads, readsFrom(read))))
	);
	return Result.isFailure(outcome) ? refuse(outcome.failure.message) : outcome.success;
};

/** A row as its stored JSON: identity and dates are plain values, never class instances. */
// repository-health:allow CLONE -- the Reads boundary detaches stored rows to plain JSON before the engine hashes or compares them; class instances never enter the engine's records.
// repository-health:allow R6a -- and T is the caller-declared row schema of that same boundary, not a decode done here.
export const plain = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T;

export const plainRows = <T>(rows: readonly unknown[]): T[] => plain(rows as T[]);

/** A stored numeric as its actual number. */
export const decodeNumber = (value: unknown): number =>
	numberOf(value) ?? refuseNow('A stored numeric requires its actual finite value.');

/** A stored number or numeric string as its finite value, or null. */
export const numberOf = (candidate: unknown): number | null => {
	if (Schema.is(Schema.Number)(candidate)) return Number.isFinite(candidate) ? candidate : null;
	if (!Schema.is(Schema.String)(candidate) || candidate.trim() === '') return null;
	const parsed = Number(candidate);
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * A money column read off a row as a number, or null when the row holds no amount. `decodeNumber` is the engine's own
 * strict door; a record view hands back whatever the wire carried — a `Decimal`, a number, a decimal string, a `$dec`
 * tag or a `{ value }` envelope — and a view must render a slip that is not settled yet rather than refuse.
 */
export const moneyNumber = (value: unknown): number | null => {
	if (value instanceof Decimal) return numberOf(value.toString());
	const held = isJsonObject(value) ? ('$dec' in value ? value['$dec'] : value['value']) : value;
	return held == null ? null : numberOf(held);
};

/** Deterministic JSON for hashing and comparison: object keys in sorted order. */
export const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));

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

const EmptyIn = Schema.Struct({ in: Schema.Array(Schema.Unknown) });

const matchesNothing = (where: object): boolean =>
	Object.values(where).some((clause) => Schema.is(EmptyIn)(clause) && clause.in.length === 0);

/** Collections whose rows outgrow one crossing answer; page them. */
const WIDE_ROWS: Partial<Record<ReadableName, number>> = {
	payroll_run: 1,
	payslip: 200,
	leave_catalog_entry: 1000,
	roster_entry: 1000
};

/** Every row of `collection` matching `where`, whole; paged where rows are too large. */
// A plain function, not `Effect.fn`: that captures a definition-site Error at module top level, and the guest's V8
// startup snapshot cannot restore the captured frames.
export const readAll = <T>(
	collection: ReadableName,
	where: object,
	page?: number,
	narrowed?: object
) =>
	Effect.gen(function* () {
		const option = yield* Effect.serviceOption(Reads);
		if (option._tag === 'None') return [];
		const reads = option.value;
		if (matchesNothing(where)) return [];
		const select = narrowed;
		page ??= select === undefined ? WIDE_ROWS[collection] : undefined;
		if (page === undefined) {
			const answer = yield* reads
				.read(collection, {
					where,
					all: true,
					...(select == null ? {} : { select })
				})
				.pipe(
					Effect.mapError(
						(cause) => new Refusal({ message: 'A whole-row read failed.', detail: String(cause) })
					)
				);
			return plainRows<T>(answer.rows);
		}
		const rows: T[] = [];
		let after: unknown = null;
		do {
			const answer = yield* reads
				.read(collection, {
					where,
					page,
					...(select == null ? {} : { select }),
					...(after == null ? {} : { after })
				})
				.pipe(
					Effect.mapError(
						(cause) => new Refusal({ message: 'A paged read failed.', detail: String(cause) })
					)
				);
			rows.push(...plainRows<T>(answer.rows));
			after = answer.after ?? null;
		} while (after != null);
		return rows;
	});

export const PAYROLL_TIME_ZONE = 'UTC';

/** An actual `YYYY-MM-DD` calendar date. */
export const isCalendarDate = (value: unknown): value is string => {
	if (!Schema.is(Schema.String)(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const stamp = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === value;
};

/** One refused value: the engine's single error, thrown where no Effect channel exists. */
export const refuseNow = (message: string, detail?: string): never => {
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

/** One client-side value: the stored JSON projection of a row. */
export type Wire<T> = T;

/** Every exposed field of one collection: no projection, so the caller row comes whole. */
export const everyField = <C extends string>(_collection: C): Record<never, never> => ({});

export const formatNamedList = (items: readonly string[]): string =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export const isYearMonth = (value: unknown): value is string =>
	Schema.is(Schema.String)(value) && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const monthEnd = (month: string): string => String(monthOf(`${month}-01`).to);

/** Whole calendar months from `from` to `to`: a month completes on the same day-of-month. */
export const completedMonths = (from: string, to: string): number =>
	(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
	(Number(to.slice(5, 7)) - Number(from.slice(5, 7))) -
	(to.slice(8, 10) >= from.slice(8, 10) ? 0 : 1);

/** The salary period one period key names. */
export const payPeriodWindow = (
	period: string,
	options: { readonly pay_frequency?: string; readonly pay_cutoff_day?: number }
): { readonly start: string; readonly end: string } => {
	const month = period.slice(0, 7);
	if (!isYearMonth(month)) refuseNow('A pay period requires its actual calendar month.');
	const frequency = options.pay_frequency ?? 'MONTHLY';
	if (frequency === 'MONTHLY' || frequency === 'INTEGER_MONTHS')
		return { start: `${month}-01`, end: monthEnd(month) };
	if (frequency === 'SEMI_MONTHLY') {
		const half = period.slice(8, 9) === '2' ? 2 : 1;
		return half === 1
			? { start: `${month}-01`, end: `${month}-15` }
			: { start: `${month}-16`, end: monthEnd(month) };
	}
	if (frequency === 'TEN_DAY') {
		const part = Number(period.slice(8, 9) || '1');
		if (part === 1) return { start: `${month}-01`, end: `${month}-10` };
		if (part === 2) return { start: `${month}-11`, end: `${month}-20` };
		return { start: `${month}-21`, end: monthEnd(month) };
	}
	return refuseNow(`Pay period ${frequency} requires its own calendar.`);
};

/** The weekly instalment starts (Sundays) a month holds, for a weekly pay cycle. */
export const weeklyInstalments = (period: string): readonly string[] => {
	const month = period.slice(0, 7);
	const start = `${month}-01`;
	const end = monthEnd(month);
	const first = new Date(`${start}T00:00:00Z`);
	first.setUTCDate(first.getUTCDate() - first.getUTCDay());
	const weeks: string[] = [];
	for (
		let day = first.toISOString().slice(0, 10);
		day <= end;
		day = new Date(Date.parse(`${day}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10)
	)
		weeks.push(day);
	return weeks;
};

/** One error's actual message. */
export const getErrorMessage = (value: unknown): string =>
	value instanceof Error ? value.message : String(value); // repository-health:allow STD2 -- this is the owner of that rule: the one place an unknown throw becomes text.
