import { Context, Data, Effect, Result, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { addDays, monthOf } from '@norbital-ai/std/date';
import type { CollectionName, Id, QueryCtx, Row, TransformCtx } from '@norbital-ai/bolt';
import relationships from '../../data/+relationship.js';

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
	/** The keyed read: every member in one crossing and one statement; absent, each member is read in turn. */
	readonly readSet?: HostReadSet;
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

/** A host's reader: a transform's `ctx.db.read` or an automation's `ctx.read`; `set` is its keyed read, when native. */
export type HostRead = (<C extends ReadableName>(
	collection: C,
	query: HostReadQuery
) => Promise<{ readonly rows: readonly HostRow<C>[]; readonly next?: unknown }>) & {
	readonly set?: HostReadSet;
};

/**
 * One member of a keyed read: a collection and its query (`all: true` — a member is read whole), or with `id` that
 * row. A `where` field's `{ in: { member, field } }` takes the values of `field` across an earlier member's rows.
 */
export type HostMember = HostReadQuery & {
	readonly collection: ReadableName;
	readonly id?: string;
};
export type HostMembers = Readonly<Record<string, HostMember>>;
/** Each member's rows by key (a get member: its row, or none). */
export type HostReadSet = (
	set: HostMembers
) => Promise<{ readonly [key: string]: readonly Readonly<Record<string, unknown>>[] }>;
type MemberRef = { readonly member: string; readonly field: string };
const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const isMemberRef = (value: unknown): value is MemberRef =>
	isJsonObject(value) &&
	Object.keys(value).length === 2 &&
	Schema.is(Schema.String)(value['member']) &&
	Schema.is(Schema.String)(value['field']);

/** A host's keyed read as {@link HostReadSet}: one crossing, one statement (`ctx.read({ … })`). */
const nativeSet =
	(read: (...args: never[]) => unknown): HostReadSet =>
	async (set) => {
		const answer: unknown = await Reflect.apply(read, undefined, [set]);
		return Object.fromEntries(
			Object.keys(set).map((key) => {
				const held = isRecord(answer) ? answer[key] : undefined;
				const rows =
					held == null ? [] : isRecord(held) && Array.isArray(held['rows']) ? held['rows'] : [held];
				return [key, rows as readonly Readonly<Record<string, unknown>>[]];
			})
		);
	};

/**
 * The keyed read of a reader: the host's own (one statement), else each member read in order with every earlier
 * member's values put in for its references (a fixture reader).
 */
export const readSetOf =
	(read: HostRead): HostReadSet =>
	(set) =>
		read.set !== undefined
			? read.set(set)
			: (async () => {
					const out: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
					const resolve = (value: unknown): unknown => {
						if (Array.isArray(value)) return value.map(resolve);
						if (!isJsonObject(value)) return value;
						return Object.fromEntries(
							Object.entries(value).map(([key, entry]) => {
								if ((key === 'in' || key === 'nin') && isMemberRef(entry))
									return [
										key,
										[
											...new Set(
												(out[entry.member] ?? [])
													.map((row) => row[entry.field])
													.filter((held) => held != null)
											)
										]
									];
								return [key, resolve(entry)];
							})
						);
					};
					for (const [key, { collection, id, ...query }] of Object.entries(set)) {
						const resolved = resolve(id === undefined ? (query.where ?? {}) : { id: { eq: id } });
						const { where, keep } = periodsApart(isJsonObject(resolved) ? resolved : {});
						out[key] = matchesNothing(where)
							? []
							: (
									(
										await read(collection, {
											...query,
											where,
											...(id === undefined ? {} : { all: true })
										})
									).rows as readonly Readonly<Record<string, unknown>>[]
								).filter(keep);
					}
					return out;
				})();

type BoltWorkspaceRead = TransformCtx<string>['db']['read'];
type BoltCallerRead = QueryCtx['read'];

type HostPage = {
	readonly rows: readonly unknown[];
	readonly next?: unknown | null;
};

/** Bolt's typed `read` is generic over `Where<C>`; a shared engine query cannot prove that. */
type LooseRead = (collection: string, query: HostReadQuery) => Promise<HostPage>;
const looseRead =
	(read: (...args: never[]) => unknown): LooseRead =>
	(collection, query) =>
		Promise.resolve(Reflect.apply(read, undefined, [collection, query]));

const hostReadPage = <C extends ReadableName>(
	page: HostPage
): {
	readonly rows: readonly HostRow<C>[];
	readonly next?: unknown;
} => ({
	rows: page.rows as HostRow<C>[],
	...(page.next == null ? {} : { next: page.next })
});

/** A transform's `ctx.db.read` as {@link HostRead}, its keyed read native (a host reader keeps its own). */
export const workspaceReadAsHost = (read: BoltWorkspaceRead | HostRead): HostRead =>
	Object.assign(
		<C extends ReadableName>(collection: C, query: HostReadQuery) =>
			looseRead(read)(collection, query).then((page) => hostReadPage<C>(page)),
		'set' in read
			? read.set === undefined
				? {}
				: { set: read.set }
			: // the host's `ctx` members are variadic; a reader that names its parameters (a fixture) has no keyed read
				read.length === 0
				? { set: nativeSet(read) }
				: {}
	);

/** An automation or action's `ctx.read` as {@link HostRead}, its keyed read native. */
export const callerReadAsHost = (read: BoltCallerRead): HostRead =>
	Object.assign(
		<C extends ReadableName>(collection: C, query: HostReadQuery) =>
			looseRead(read)(collection, query).then((page) => hostReadPage<C>(page)),
		{ set: nativeSet(read) }
	);

/** One pending read of a batch: its query and the answer it waits on. */
type Pending = {
	readonly collection: ReadableName;
	readonly query: HostReadQuery;
	readonly resolve: (page: { readonly rows: readonly unknown[]; readonly next?: unknown }) => void;
	readonly reject: (cause: unknown) => void;
};

/** A clause naming plain values (`eq` or `in`), as the values; else undefined. */
const pinnedValues = (clause: unknown): readonly unknown[] | undefined => {
	if (!isJsonObject(clause)) return undefined;
	const [op, ...more] = Object.keys(clause);
	if (more.length > 0) return undefined;
	const operand = op === undefined ? undefined : clause[op];
	if (op === 'eq' && operand != null && !isJsonObject(operand) && !Array.isArray(operand))
		return [operand];
	if (op === 'in' && Array.isArray(operand)) return operand;
	return undefined;
};

/**
 * A reader that batches (a data loader): the reads issued together — the same walk run for many rows at once — go
 * as one read per shape. Reads of one collection, selection and paging whose `where` differ only in one field's
 * `eq`/`in` read once over the union and are split by that field; identical reads share one. Run each row's walk
 * concurrently over it and a batch costs a walk's reads, not a walk's reads per row.
 */
export const batchedRead = (read: HostRead): HostRead => {
	let queue: Pending[] = [];
	const flush = () => {
		const batch = queue;
		queue = [];
		const groups = new Map<string, Pending[]>();
		for (const call of batch) {
			const { where, ...rest } = call.query;
			const key = stableJson([call.collection, rest, Object.keys(where ?? {}).toSorted()]);
			const held = groups.get(key);
			if (held === undefined) groups.set(key, [call]);
			else held.push(call);
		}
		for (const group of groups.values()) void run(group);
	};
	const one = (call: Pending) => read(call.collection, call.query).then(call.resolve, call.reject);
	const run = async (group: readonly Pending[]) => {
		const [first] = group;
		if (first === undefined) return;
		const wheres = group.map((call): object => call.query.where ?? {});
		const varying = Object.keys(wheres[0] ?? {}).filter(
			(key) => new Set(wheres.map((where) => stableJson(Reflect.get(where, key)))).size > 1
		);
		if (varying.length === 0) {
			const answer = read(first.collection, first.query);
			for (const call of group) answer.then(call.resolve, call.reject);
			return;
		}
		const [key] = varying;
		const values = wheres.map((where) =>
			key === undefined ? undefined : pinnedValues(Reflect.get(where, key))
		);
		const select = first.query.select;
		// A limited read merges only on `id` (one row each); the split field must come back.
		if (
			varying.length > 1 ||
			key === undefined ||
			values.some((held) => held === undefined) ||
			group.some((call) => call.query.after != null) ||
			(first.query.all !== true && key !== 'id')
		) {
			for (const call of group) void one(call);
			return;
		}
		// `id` always comes back; another split field a narrowed select lacks is added and taken off again
		const added = key !== 'id' && select != null && !(key in select) ? key : undefined;
		const { limit: _limit, ...query } = first.query;
		try {
			const answer = await read(first.collection, {
				...query,
				all: true,
				where: { ...wheres[0], [key]: { in: [...new Set(values.flatMap((held) => held ?? []))] } },
				...(added === undefined ? {} : { select: { ...select, [added]: true } })
			});
			group.forEach((call, i) => {
				const wanted = new Set(values[i]);
				call.resolve({
					rows: answer.rows
						.filter((row) => wanted.has(Reflect.get(row, key)))
						.map((row) =>
							added === undefined
								? row
								: Object.fromEntries(Object.entries(row).filter(([field]) => field !== added))
						)
				});
			});
		} catch (cause) {
			for (const call of group) call.reject(cause);
		}
	};
	return Object.assign(
		<C extends ReadableName>(collection: C, query: HostReadQuery) =>
			new Promise<{ readonly rows: readonly unknown[]; readonly next?: unknown }>(
				(resolve, reject) => {
					if (queue.length === 0) setTimeout(flush, 0);
					queue.push({ collection, query, resolve, reject });
				}
			) as Promise<{
				readonly rows: readonly HostRow<C>[];
				readonly next?: unknown;
			}>,
		read.set === undefined ? {} : { set: read.set }
	) satisfies HostRead;
};

/**
 * Each row's walk run concurrently over one batched reader; a refusal stops the batch at the first row that refused,
 * in input order, as the walk one row at a time would.
 */
export const eachBatched = async <I, O>(
	inputs: readonly I[],
	read: HostRead,
	walk: (input: I, index: number, read: HostRead) => Promise<O>
): Promise<O[]> => {
	const batched = batchedRead(read);
	const settled = await Promise.allSettled(inputs.map((input, i) => walk(input, i, batched)));
	return settled.map((outcome) => {
		if (outcome.status === 'rejected') throw outcome.reason;
		return outcome.value;
	});
};

/** The engine's reads over one host reader: whole reads stay whole, paged reads carry the host's cursor. */
export const readsFrom = (read: HostRead | BoltWorkspaceRead): ReadsShape => {
	const hostRead = workspaceReadAsHost(read);
	return {
		// a host's own keyed read (one statement); a fixture reader has none, and its members are read in turn
		...(hostRead.set === undefined ? {} : { readSet: hostRead.set }),
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

/**
 * A keyed read through the engine's reader: every member at once (one statement on a host), each member's rows by key.
 * A reader without one (a fixture's `read`) reads each member in turn.
 */
export const readKeyed = (set: HostMembers) =>
	Effect.gen(function* () {
		const option = yield* Effect.serviceOption(Reads);
		if (option._tag === 'None')
			return {} as { readonly [key: string]: readonly Readonly<Record<string, unknown>>[] };
		const reads = option.value;
		const hostRead = Object.assign(
			(collection: ReadableName, query: HostReadQuery) =>
				Effect.runPromise(
					reads.read(collection, {
						...query,
						...(query.all === true ? {} : { page: query.limit ?? 200 })
					})
				).then((page) => ({ rows: page.rows as never[] })),
			{}
		) as HostRead;
		const readSet = reads.readSet ?? readSetOf(hostRead);
		return yield* Effect.tryPromise({
			try: () => readSet(set),
			catch: (cause) => new Refusal({ message: 'A keyed read failed.', detail: String(cause) })
		});
	});

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

/** A host row's values as CEL reads them: a stored decimal is its number, everything else as it came. */
export const celValues = (value: unknown): unknown => {
	if (value instanceof Decimal) return Number(value.toString());
	if (Array.isArray(value)) return value.map(celValues);
	if (Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value))
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, celValues(entry)]));
	return value;
};

/** Deterministic JSON for hashing and comparison: object keys in sorted order. */
export const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));

/** The prior values of the fields an update changes (`before`, stored by the transform for the row taps). */
export const beforeOf = (
	existing: object | undefined,
	input: object
): { [field: string]: Json } => {
	const held: Readonly<Record<string, unknown>> = { ...existing };
	const out: { [field: string]: Json } = {};
	for (const [field, value] of Object.entries(input))
		if (field !== 'before' && field !== 'id' && stableJson(held[field]) !== stableJson(value)) {
			const prior = plain(held[field] ?? null);
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

/**
 * What a joined read selects: `true` for a field, `{ many, where? }` for a many-relation (by its inverse name, every
 * matching child), `{ one: fk, select }` for the row a foreign key names (kept beside the key, under the alias).
 */
export type Selection = { readonly [key: string]: true | ManyArm | OneArm };
export type ManyArm = { readonly many: Selection; readonly where?: object };
export type OneArm = { readonly one: string; readonly select: Selection };

type RelationSpec = { readonly to: string | readonly string[]; readonly inverse?: string };
const RELATIONS = Object.entries(relationships as Readonly<Record<string, RelationSpec>>).map(
	([key, spec]) => {
		const [child = '', fk = ''] = key.split('.');
		return {
			child,
			fk,
			to: Schema.is(Schema.String)(spec.to) ? spec.to : '',
			inverse: spec.inverse
		};
	}
);
const manyOf = (collection: string, name: string) => {
	const found = RELATIONS.find((rel) => rel.to === collection && rel.inverse === name);
	return found ?? refuseNow(`${collection} has no relation ${name}.`);
};
const oneOf = (collection: string, fk: string) => {
	const found = RELATIONS.find((rel) => rel.child === collection && rel.fk === fk);
	return found ?? refuseNow(`${collection}.${fk} is no relation.`);
};
const isMany = (arm: true | ManyArm | OneArm): arm is ManyArm => arm !== true && 'many' in arm;
const isOne = (arm: true | ManyArm | OneArm): arm is OneArm => arm !== true && 'one' in arm;

/** A selection as the host's `select`: arms are relation selects, a one-arm selected under its key. */
const hostSelect = (selection: Selection): object =>
	Object.fromEntries(
		Object.entries(selection).map(([key, arm]) =>
			isMany(arm)
				? [
						key,
						{
							select: hostSelect(arm.many),
							all: true,
							...(arm.where == null ? {} : { where: arm.where })
						}
					]
				: isOne(arm)
					? [arm.one, { select: hostSelect(arm.select) }]
					: [key, true]
		)
	);

/** The host's answer as the selection's shape: a one-arm's row under its alias, its key back to the id. */
const shaped = (
	selection: Selection,
	row: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...row };
	for (const [key, arm] of Object.entries(selection)) {
		if (isMany(arm))
			out[key] = (Array.isArray(row[key]) ? row[key] : []).map((child: unknown) =>
				shaped(arm.many, isJsonObject(child) ? child : {})
			);
		else if (isOne(arm)) {
			const held = row[arm.one];
			out[key] = isJsonObject(held) ? shaped(arm.select, held) : null;
			// A row the key names but the reader cannot see keeps no key: the arm answers null for both.
			out[arm.one] = isJsonObject(held) ? (held['id'] ?? null) : null;
		}
	}
	return out;
};

/** A reader without arms: the parent read, then one read per arm over every parent, joined in memory. */
const emulated = (
	reads: ReadsShape,
	collection: ReadableName,
	given: object,
	selection: Selection,
	earlier: Earlier = new Map()
): Effect.Effect<Record<string, unknown>[], Refusal> =>
	Effect.gen(function* () {
		const { where, keep } = periodsApart(resolveRefs(given, earlier));
		if (matchesNothing(where)) return [];
		const fields = Object.fromEntries(
			Object.entries(selection).flatMap(([key, arm]) =>
				isMany(arm) ? [] : isOne(arm) ? [[arm.one, true]] : [[key, true]]
			)
		);
		const answer = yield* reads.read(collection, { where, select: fields, all: true });
		return yield* completed(
			reads,
			collection,
			selection,
			plainRows<Record<string, unknown>>(answer.rows).filter(keep),
			earlier
		);
	});
type Earlier = ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>;

/**
 * The arms a reader left out (a fixture answers fields only), each filled by one read over every row; arms the host
 * answered are shaped as they are.
 */
const completed = (
	reads: ReadsShape,
	collection: ReadableName,
	selection: Selection,
	rows: readonly Record<string, unknown>[],
	earlier: Earlier = new Map()
): Effect.Effect<Record<string, unknown>[], Refusal> =>
	Effect.gen(function* () {
		const out = rows.map((row) => ({ ...row }));
		for (const [key, arm] of Object.entries(selection)) {
			if (isMany(arm)) {
				if (out.every((row) => key in row)) {
					for (const row of out)
						row[key] = (Array.isArray(row[key]) ? row[key] : []).map((child: unknown) =>
							shaped(arm.many, isJsonObject(child) ? child : {})
						);
					continue;
				}
				const rel = manyOf(collection, key);
				const children = yield* emulated(
					reads,
					rel.child as ReadableName,
					{ ...arm.where, [rel.fk]: { in: out.map((row) => row['id']) } },
					{ ...arm.many, [rel.fk]: true },
					earlier
				);
				for (const row of out) row[key] = children.filter((child) => child[rel.fk] === row['id']);
			} else if (isOne(arm)) {
				if (out.every((row) => row[arm.one] == null || isJsonObject(row[arm.one]))) {
					for (const row of out) {
						const held = row[arm.one];
						row[key] = isJsonObject(held) ? shaped(arm.select, held) : null;
						row[arm.one] = isJsonObject(held) ? (held['id'] ?? null) : null;
					}
					continue;
				}
				const ids = [...new Set(out.map((row) => row[arm.one]).filter((id) => id != null))];
				const targets = yield* emulated(
					reads,
					oneOf(collection, arm.one).to as ReadableName,
					{ id: { in: ids } },
					{ ...arm.select, id: true },
					earlier
				);
				for (const row of out)
					row[key] = targets.find((target) => target['id'] === row[arm.one]) ?? null;
			}
		}
		return out;
	});

/**
 * Every row of `collection` matching `where` with its related rows, in one host read: each relation arm is a part of
 * the same statement. A reader that answers fields only (a fixture) has each arm filled by one read of its own.
 */
export const readJoined = <T>(collection: ReadableName, where: object, selection: Selection) =>
	Effect.gen(function* () {
		const option = yield* Effect.serviceOption(Reads);
		if (option._tag === 'None') return [];
		const reads = option.value;
		if (matchesNothing(where)) return [];
		const answer = yield* reads
			.read(collection, { where, select: hostSelect(selection), all: true })
			.pipe(
				Effect.mapError(
					(cause) => new Refusal({ message: 'A joined read failed.', detail: String(cause) })
				)
			);
		return (yield* completed(
			reads,
			collection,
			selection,
			plainRows<Record<string, unknown>>(answer.rows)
		)) as T[];
	});

/**
 * A `where` without its period clauses (`contains` a day, `overlaps` a period) and the test that judges them on a row:
 * a fixture reader's own filter need not know them.
 */
const periodsApart = (
	all: Readonly<Record<string, unknown>>
): {
	where: Record<string, unknown>;
	keep: (row: Readonly<Record<string, unknown>>) => boolean;
} => {
	const within = (range: unknown, point: unknown): boolean => {
		const held = isRecord(range) ? range : {};
		const [from, to] = isRecord(point)
			? [String(point['from']), String(point['to'] ?? '9999-12-31')]
			: [String(point), String(point)];
		return String(held['from'] ?? '') <= to && (held['to'] == null || from <= String(held['to']));
	};
	const contained = Object.entries(all).flatMap(([field, clause]) => {
		const [op, ...more] = isRecord(clause) ? Object.keys(clause) : [];
		return isRecord(clause) && more.length === 0 && (op === 'contains' || op === 'overlaps')
			? [[field, clause[op]] as const]
			: [];
	});
	return {
		where: Object.fromEntries(
			Object.entries(all).filter(([field]) => !contained.some(([held]) => held === field))
		),
		keep: (row) => contained.every(([field, point]) => within(row[field], point))
	};
};

/** The values at a dotted path through rows (a many arm's rows each give theirs), as a reference names them. */
const valuesAt = (rows: readonly unknown[], path: string): readonly unknown[] =>
	path
		.split('.')
		.reduce<readonly unknown[]>(
			(values, part) =>
				values.flatMap((value) => {
					const held = isRecord(value) ? value[part] : undefined;
					return Array.isArray(held) ? held : [held];
				}),
			rows
		)
		.filter((value) => value != null);

/** A `where` with every `{ in | nin: { member, field } }` put in from earlier members' rows (a fixture reader's). */
const resolveRefs = (
	where: object,
	earlier: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>
): Readonly<Record<string, unknown>> => {
	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk);
		if (!isRecord(value)) return value;
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) =>
				(key === 'in' || key === 'nin') && isMemberRef(entry)
					? [key, [...new Set(valuesAt(earlier.get(entry.member) ?? [], entry.field))]]
					: [key, walk(entry)]
			)
		);
	};
	const out = walk(where);
	return isRecord(out) ? out : {};
};

/** A shaped row as a host answers it: a one-arm's row under its foreign key (`shaped`'s inverse). */
const hostShaped = (
	selection: Selection,
	row: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
	const out: Record<string, unknown> = { ...row };
	for (const [key, arm] of Object.entries(selection)) {
		if (isMany(arm))
			out[key] = (Array.isArray(row[key]) ? row[key] : []).map((child: unknown) =>
				hostShaped(arm.many, isRecord(child) ? child : {})
			);
		else if (isOne(arm)) {
			const held = row[key];
			out[arm.one] = isRecord(held) ? hostShaped(arm.select, held) : (row[arm.one] ?? null);
			if (key !== arm.one) delete out[key];
		}
	}
	return out;
};

/** One member of `readJoinedSet`: a collection, its `where` (references to earlier members allowed) and selection. */
export type JoinedMember = {
	readonly collection: ReadableName;
	readonly where: object;
	readonly selection: Selection;
};

/**
 * `readJoined` for several reads at once: one keyed read (one statement on a host), each member's rows in its
 * selection's shape. A member's `where` may take an earlier member's values (`{ in: { member, field } }`). A reader that
 * answers fields only (a fixture) has each member's arms filled by reads of their own.
 */
export const readJoinedSet = <K extends string>(set: { readonly [P in K]?: JoinedMember }) =>
	Effect.gen(function* () {
		const out = new Map<string, readonly Record<string, unknown>[]>();
		/** A member's rows as the caller's row type, as `readJoined` gives them. */
		const rows = <T>(key: K | (string & {})): readonly T[] => (out.get(key) ?? []) as T[];
		const option = yield* Effect.serviceOption(Reads);
		if (option._tag === 'None') return rows;
		const reads = option.value;
		const entries = (Object.keys(set) as K[]).flatMap((key): [K, JoinedMember][] => {
			const member = set[key];
			return member === undefined ? [] : [[key, member]];
		});
		const hostMember = (member: JoinedMember) => ({
			collection: member.collection,
			where: member.where,
			select: hostSelect(member.selection),
			all: true
		});
		if (reads.readSet !== undefined) {
			// a host: one keyed read, every arm in the same statement
			const got = yield* readKeyed(
				Object.fromEntries(entries.map(([key, member]) => [key, hostMember(member)]))
			);
			for (const [key, member] of entries)
				out.set(
					key,
					yield* completed(
						reads,
						member.collection,
						member.selection,
						plainRows<Record<string, unknown>>(got[key] ?? [])
					)
				);
			return rows;
		}
		// a fixture reader: each member in turn, its arms filled by reads of their own; a reference reads an earlier
		// member's rows as a host would hold them (an arm under its foreign key or relation name)
		const native = new Map<string, readonly Readonly<Record<string, unknown>>[]>();
		for (const [key, member] of entries) {
			const { where, keep } = periodsApart(resolveRefs(member.where, native));
			const filled = matchesNothing(where)
				? []
				: yield* completed(
						reads,
						member.collection,
						member.selection,
						plainRows<Record<string, unknown>>(
							(yield* reads.read(member.collection, {
								where,
								select: hostSelect(member.selection),
								all: true
							})).rows.filter((row) => keep(isRecord(row) ? row : {}))
						),
						native
					);
			out.set(key, filled);
			native.set(
				key,
				filled.map((row) => hostShaped(member.selection, row))
			);
		}
		return rows;
	});

/** `readJoinedSet` over a host reader, for code outside the engine's effects (automations, transforms). */
export const joinedSetOf =
	(read: HostRead) =>
	<K extends string>(set: { readonly [P in K]?: JoinedMember }) =>
		Effect.runPromise(readJoinedSet(set).pipe(Effect.provideService(Reads, readsFrom(read))));

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
	options: {
		readonly pay_frequency?: string;
		readonly pay_cutoff_day?: number;
		/** The version's `payroll.week_start` (0 = Sunday … 6 = Saturday; default Sunday). */
		readonly week_start?: number;
		/** The version's `payroll.semi_monthly_split`: the first half's last day (default 15). */
		readonly semi_monthly_split?: number;
	}
): { readonly start: string; readonly end: string } => {
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
			: { start: String(addDays(`${month}-${split}`, 1)), end: monthEnd(month) };
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
		return { start, end: String(addDays(start, 6)) };
	}
	if (frequency === 'DAILY') {
		if (!isCalendarDate(period))
			return refuseNow('A daily pay period requires its actual calendar day.');
		return { start: period, end: period };
	}
	return refuseNow(`Pay period ${frequency} requires its own calendar.`);
};

/** A switch of pay frequency: from this day the entity pays at `frequency`. */
export type FrequencyChange = { readonly from: string; readonly frequency: string };
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
): readonly { readonly frequency: string; readonly from: string; readonly to: string }[] => {
	const spans: { frequency: string; from: string; to: string }[] = [];
	for (let day = `${month}-01`; day.startsWith(month); day = String(addDays(day, 1))) {
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
	options: { readonly week_start?: number; readonly semi_monthly_split?: number } = {}
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
		const days =
			span.frequency === 'DAILY'
				? (() => {
						const out: string[] = [];
						for (let day = span.from; day <= span.to; day = String(addDays(day, 1))) out.push(day);
						return out;
					})()
				: keys;
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
	for (let day = `${month}-01`; day.startsWith(month); day = String(addDays(day, 1)))
		if (new Date(`${day}T00:00:00Z`).getUTCDay() === weekStart) weeks.push(day);
	return weeks;
};

/** One error's actual message. */
export const getErrorMessage = (value: unknown): string =>
	value instanceof Error ? value.message : String(value); // repository-health:allow STD2 -- this is the owner of that rule: the one place an unknown throw becomes text.
