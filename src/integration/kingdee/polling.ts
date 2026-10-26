import { Effect, Result, Schema } from 'effect';
import type { FacilityFailure, Unavailable } from '@norbital-ai/bolt/errors';
import { sha256Hex, type DigestUnavailable } from '../../lib/commercial.js';
import type { Health, Id } from '@norbital-ai/bolt';
import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { inputSchema } from '@norbital-ai/std/kind';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import type { SourceProjection as Projection } from './sql.js';
import { sourceIdentity, sourceMetadata, sourceClock, sourcePage, sourceMarkers } from './sql.js';
import { bindings, normalizeSourceRow, type SourceBindingName } from './source-bindings.js';
export class SourceRowInvalid extends Schema.TaggedError<SourceRowInvalid>()('SourceRowInvalid', {
	column: Schema.String,
	reason: Schema.String
}) {}
export class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
	'SourceUnavailable',
	{
		reason: Schema.String
	}
) {}
class CheckpointInvalid extends Schema.TaggedError<CheckpointInvalid>()('CheckpointInvalid', {
	reason: Schema.String
}) {}
const PAGE = 999;
const ZERO = '0x0000000000000000';
const Rowversion = Schema.String.check(Schema.isPattern(/^0x[0-9a-f]{16}$/i));
const Continuation = Schema.Struct({
	mode: Schema.Literals(['snapshot', 'changes', 'reconcile', 'finish']),
	upper: Rowversion,
	after: Schema.String.check(Schema.isPattern(/^(?:[\x21-\x7e]{1,4096})?$/)),
	started: Schema.String
});
const Cursor = Schema.Struct({
	protocol: Schema.Literal('rowversion-v1'),
	source: Schema.String,
	bookmark: Rowversion,
	fullAt: Schema.NullOr(Schema.String),
	continuation: Schema.NullOr(Continuation)
});
type Cursor = typeof Cursor.Type;
const SqlResult = Schema.Struct({ rows: Schema.Array(Schema.Record(Schema.String, Schema.Json)) });
/** SQL transport belongs to the host; polling and source semantics belong to this integration. */
export type DatabaseContext = {
	request: (op: DatabaseRequest) => Effect.Effect<DatabaseResult, FacilityFailure | Unavailable>;
};
export type SqlRow = { readonly [column: string]: Json };
export const query = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	operation: DatabaseRequest
) {
	return (yield* Schema.decodeUnknownEffect(SqlResult)(yield* ctx.request(operation)).pipe(
		Effect.mapError((cause) => new SourceRowInvalid({ column: '$result', reason: String(cause) }))
	)).rows;
});
const PrintableKey = Schema.String.check(Schema.isPattern(/^[\x21-\x7e]{1,4096}$/));
const key = (value: Json | undefined): string => {
	const decoded = Schema.decodeUnknownResult(PrintableKey)(value);
	if (Result.isFailure(decoded))
		throw new SourceRowInvalid({
			column: '__key',
			reason: 'Projection requires a stable printable key'
		});
	return decoded.success;
};
const Precise = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/));
/**
 * A SQL row's columns as model values. A NULL column answers its fallback, or fails without one; a value of another wire
 * type fails, so a page commits nothing it could not read.
 */
export function columns(row: SqlRow) {
	const reader = <S, T>(
		schema: Schema.Codec<S, unknown>,
		convert: (value: S) => T,
		kind: string
	) => {
		const decode = Schema.decodeUnknownSync(schema);
		function read(name: string): T;
		function read<F>(name: string, fallback: F): T | F;
		function read(name: string, ...fallback: unknown[]) {
			const value = row[name] ?? null;
			if (value === null) {
				if (fallback.length === 0)
					throw new SourceRowInvalid({
						column: name,
						reason: `Accounting column ${name} is required`
					});
				return fallback[0];
			}
			const decoded = Result.try(() => convert(decode(value)));
			if (Result.isFailure(decoded))
				throw new SourceRowInvalid({
					column: name,
					reason:
						kind === 'decimal'
							? 'Precise amounts must be projected as text'
							: `Accounting column ${name} is not ${kind}`
				});
			return decoded.success;
		}
		return read;
	};
	const same = <S>(value: S) => value;
	return {
		id: <C extends string>(name: string, _collection: C) =>
			reader(
				Schema.declare<Id<C>>((input): input is Id<C> =>
					Schema.is(inputSchema({ kind: 'id', of: _collection }))(input)
				),
				same,
				'an id'
			)(name),
		text: reader(Schema.String, same, 'text'),
		bool: reader(Schema.Boolean, same, 'a bit'),
		decimal: reader(Precise, (value) => Decimal.of(value), 'decimal'),
		currency: reader(Schema.String, currency, 'a currency'),
		date: reader(Schema.String, PlainDate, 'a date'),
		instant: reader(Schema.String, Instant, 'an instant'),
		one: <const V extends readonly string[]>(name: string, values: V): V[number] => {
			const found = values.find((option) => option === row[name]);
			if (found === undefined)
				throw new SourceRowInvalid({
					column: name,
					reason: `Accounting column ${name} is not one of its values`
				});
			return found;
		}
	};
}

export const sourceState = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	projection: Projection
) {
	const identityRows = yield* sourceIdentity(ctx);
	const identity = yield* Schema.decodeUnknownEffect(
		Schema.Struct({ database_guid: Schema.String, recovery_fork_guid: Schema.String })
	)(identityRows[0]).pipe(
		Effect.mapError((cause) => new SourceUnavailable({ reason: String(cause) }))
	);
	const metadata = yield* Schema.decodeUnknownEffect(
		Schema.Array(
			Schema.Struct({
				alias: Schema.String,
				column: Schema.NullOr(Schema.String),
				object_id: Schema.Int,
				created: Schema.String,
				rowversion_type: Schema.NullOr(Schema.Int)
			})
		)
	)(yield* sourceMetadata(ctx, projection)).pipe(
		Effect.mapError((cause) => new SourceUnavailable({ reason: String(cause) }))
	);
	const declared = sourceMarkers(projection);
	const relations = [
		{ alias: projection.alias ?? 'source', table: projection.table },
		...(projection.joins ?? [])
	];
	const expected = relations.flatMap((relation) => {
		const markers = declared.filter((marker) => marker.tableAlias === relation.alias);
		return (markers.length === 0 ? [null] : markers).map((marker) => ({
			alias: relation.alias,
			column: marker?.name ?? null
		}));
	});
	if (
		metadata.length !== expected.length ||
		expected.some(
			(entry) =>
				!metadata.some(
					(row) =>
						row.alias === entry.alias &&
						row.column === entry.column &&
						(entry.column === null || row.rowversion_type === 189)
				)
		)
	)
		return yield* new SourceUnavailable({
			reason: 'A declared Kingdee table or native rowversion column is unavailable'
		});
	// Capture the ceiling before reading any rows; never derive it from the last row returned.
	const clockRows = yield* sourceClock(ctx);
	const current = yield* Schema.decodeUnknownEffect(
		Schema.Struct({ maximum: Rowversion, observed_at: Schema.String })
	)(clockRows[0]).pipe(
		Effect.mapError((cause) => new SourceUnavailable({ reason: String(cause) }))
	);
	if (!Number.isFinite(Date.parse(current.observed_at)))
		return yield* new SourceUnavailable({ reason: 'The SQL Server clock is unavailable' });
	return {
		source: yield* sha256Hex(
			JSON.stringify([identity.database_guid, identity.recovery_fork_guid, metadata, projection])
		),
		maximum: current.maximum.toLowerCase(),
		now: current.observed_at
	};
});
export type SourcePage<R> = {
	readonly rows: readonly (R & { readonly $id: string; readonly $version?: string })[];
	readonly cursor: Json;
	readonly more: boolean;
	readonly snapshot?: 'begin' | 'end';
	readonly health?: Health;
};
export type Reconciler<R extends object> = (after: string) => Effect.Effect<
	{
		readonly rows: readonly (R & { readonly $id: string })[];
		readonly after: string;
		readonly more: boolean;
	},
	FacilityFailure | Unavailable | SourceRowInvalid
>;
/**
 * Current-state polling: native eight-byte rowversions select [bookmark, upper); feeds without a verified marker use
 * complete listings. Periodic listings also reconcile physical deletions. The native engine commits each page and its
 * continuation together; only the final page advances the completed-window bookmark. An authoritative listing reapplies values even when a joined field changed without advancing its base marker. It is not an audit log
 * or a source-wide transaction snapshot. Preserved feeds explicitly deactivate missing rows after a successful full listing.
 */
export const readSource = Effect.fnUntraced(function* <R extends object, M extends object = never>(
	projection: Projection,
	cursor: Json | null,
	ctx: DatabaseContext & {
		readonly configuration: {
			readonly fullSnapshotMinutes: number;
			readonly maxWindowMinutes: number;
			readonly baseCurrency: string;
		};
	},
	build: (row: SqlRow) => R,
	reconcile?: Reconciler<M>
): Effect.fn.Return<
	SourcePage<R | M>,
	| FacilityFailure
	| Unavailable
	| SourceRowInvalid
	| SourceUnavailable
	| CheckpointInvalid
	| DigestUnavailable
> {
	const current = yield* sourceState(ctx, projection);
	const versioned = sourceMarkers(projection).length > 0;
	let state: Cursor =
		cursor === null
			? {
					protocol: 'rowversion-v1',
					source: current.source,
					bookmark: ZERO,
					fullAt: null,
					continuation: null
				}
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
					Effect.mapError((cause) => new CheckpointInvalid({ reason: String(cause) }))
				);
	state = {
		...state,
		bookmark: state.bookmark.toLowerCase(),
		continuation:
			state.continuation === null
				? null
				: {
						...state.continuation,
						upper: state.continuation.upper.toLowerCase()
					}
	};
	if (state.source !== current.source)
		return yield* new CheckpointInvalid({
			reason: 'The source database or projection changed; a fresh source snapshot is required'
		});
	if (
		current.maximum < state.bookmark ||
		(state.continuation !== null && current.maximum < state.continuation.upper)
	)
		return yield* new CheckpointInvalid({
			reason: 'The source rowversion moved behind the saved bookmark'
		});
	if (
		(state.fullAt !== null && !Number.isFinite(Date.parse(state.fullAt))) ||
		(state.continuation !== null && !Number.isFinite(Date.parse(state.continuation.started)))
	)
		return yield* new CheckpointInvalid({ reason: 'The saved source window has an invalid clock' });
	const full =
		state.fullAt === null ||
		!versioned ||
		Date.parse(current.now) - Date.parse(state.fullAt) >=
			ctx.configuration.fullSnapshotMinutes * 60000;
	const position = state.continuation ?? {
		mode: full ? ('snapshot' as const) : ('changes' as const),
		upper: current.maximum,
		after: '',
		started: current.now
	};
	if (position.upper < state.bookmark || (position.mode === 'changes' && !versioned))
		return yield* new CheckpointInvalid({
			reason: 'The saved source window does not match this feed'
		});
	const health: Health =
		Date.parse(current.now) - Date.parse(position.started) >
		ctx.configuration.maxWindowMinutes * 60000
			? { state: 'attention', code: 'windowLag' }
			: { state: 'ready' };
	if (position.mode === 'finish')
		return {
			rows: [],
			cursor: { ...state, bookmark: position.upper, fullAt: position.started, continuation: null },
			more: false,
			...(reconcile === undefined ? { snapshot: 'end' as const } : {}),
			health
		};
	if (position.mode === 'reconcile') {
		if (reconcile === undefined)
			return yield* new CheckpointInvalid({
				reason: 'The saved reconciliation no longer matches this feed'
			});
		const page = yield* reconcile(position.after);
		return {
			rows: page.rows,
			more: page.more,
			cursor: page.more
				? { ...state, continuation: { ...position, after: page.after } }
				: { ...state, bookmark: position.upper, fullAt: position.started, continuation: null },
			health
		};
	}
	const result = yield* sourcePage(
		ctx,
		projection,
		position.after,
		position.mode === 'changes' ? { from: state.bookmark, to: position.upper } : undefined
	);
	const binding = (Object.keys(bindings) as SourceBindingName[]).find(
		(name) => bindings[name] === projection
	);
	if (result.length > PAGE + 1)
		return yield* new SourceRowInvalid({
			column: '$result',
			reason: 'The source page exceeded its row bound'
		});
	const rows = yield* Effect.try({
		try: () => {
			let after = position.after;
			const checked = result.map((row) => {
				const remote = key(row['__key']);
				if (remote <= after)
					throw new SourceRowInvalid({
						column: '__key',
						reason: 'Source keys are not strictly ordered and unique'
					});
				after = remote;
				const version = !versioned
					? undefined
					: Schema.decodeUnknownSync(Rowversion)(row['__rowversion']).toLowerCase();
				if (
					version !== undefined &&
					position.mode === 'changes' &&
					(version < state.bookmark || version >= position.upper)
				)
					throw new SourceRowInvalid({
						column: '__rowversion',
						reason: 'A source row is outside the captured half-open window'
					});
				return { row, remote, version };
			});
			return checked.slice(0, PAGE).map(({ row, remote, version }) => ({
				...build(
					binding === undefined
						? row
						: normalizeSourceRow(binding, row, ctx.configuration, current.now)
				),
				$id: remote,
				...(version === undefined || position.mode === 'snapshot'
					? {}
					: { $version: BigInt(version).toString() })
			}));
		},
		catch: (cause) =>
			cause instanceof SourceRowInvalid
				? cause
				: new SourceRowInvalid({ column: '$row', reason: String(cause) })
	});
	const after = rows.at(-1)?.$id ?? position.after;
	if (result.length > PAGE)
		return {
			rows,
			cursor: { ...state, continuation: { ...position, after } },
			more: true,
			...(position.mode === 'snapshot' && position.after === '' && reconcile === undefined
				? { snapshot: 'begin' as const }
				: {}),
			health
		};
	if (position.mode === 'snapshot')
		// Even a single-page recurring snapshot must begin a new cycle before ending it. The empty final page makes
		// completion explicit and prevents absence reconciliation after a partial or failed listing.
		return {
			rows,
			cursor: {
				...state,
				continuation: {
					...position,
					mode: reconcile === undefined ? 'finish' : 'reconcile',
					after: reconcile === undefined ? after : ''
				}
			},
			more: true,
			...(position.after === '' && reconcile === undefined ? { snapshot: 'begin' as const } : {}),
			health
		};
	return {
		rows,
		cursor: { ...state, bookmark: position.upper, continuation: null },
		more: false,
		health
	};
});
