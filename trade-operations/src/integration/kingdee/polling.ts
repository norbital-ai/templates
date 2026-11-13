import {
	BigDecimal,
	DateTime,
	Duration,
	Effect,
	Record as EffectRecord,
	Result,
	Schema
} from 'effect';
import type { FacilityFailure, ReadFailed, Unavailable } from '@norbital-ai/bolt/errors';
import { sha256Hex, type DigestUnavailable } from '../../lib/commercial.js';
import {
	input_schema,
	type CurrencyCode,
	type Health,
	type Id,
	type InstanceId
} from '@norbital-ai/bolt';
import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import type { SourceProjection as Projection } from './sql.js';
import { sourceCheckpoint, sourcePage, sourceMarkers } from './sql.js';
import { bindings, normalizeSourceRow } from './source-bindings.js';
/** An ISO 4217 code the runtime knows; anything else throws. */
export function currency(code: string): CurrencyCode {
	if (!isCurrency(code)) throw new RangeError(`'${code}' is not an ISO 4217 currency`);
	return code;
}
const isCurrency = (code: string): code is CurrencyCode =>
	/^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf('currency').includes(code);
/** A calendar day `YYYY-MM-DD`; anything else throws. */
export function PlainDate(text: string): string {
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
		DateTime.formatIsoDateUtc(DateTime.makeUnsafe(text)) !== text
	)
		throw new RangeError(`'${text}' is not a calendar date (YYYY-MM-DD)`);
	return text;
}
/** An ISO instant with `Z` or an offset, as canonical UTC `…Z`; anything else throws. */
export function Instant(text: string): string {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i.test(text))
		throw new RangeError(`'${text}' is not an ISO instant with a zone`);
	return new Date(text).toISOString();
}
export class SourceRowInvalid extends Schema.TaggedError<SourceRowInvalid>()('SourceRowInvalid', {
	column: Schema.String,
	reason: Schema.String
}) {
	override get message() {
		return `${this.column}: ${this.reason}`;
	}
}
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
		id: <C extends string>(name: string, _model: C) =>
			reader(
				Schema.declare<Id<C>>((input): input is Id<C> =>
					Schema.is(input_schema({ kind: 'ref', to: _model }))(input)
				),
				same,
				'an id'
			)(name),
		text: reader(Schema.String, same, 'text'),
		bool: reader(Schema.Boolean, same, 'a bit'),
		decimal: reader(Precise, BigDecimal.fromStringUnsafe, 'decimal'),
		/** A decimal column as the exact text a decimal field stores. */
		decimalText: reader(Precise, same, 'decimal'),
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
	// Capture the ceiling before reading any rows. Keep the fingerprint's metadata shape unchanged.
	const checkpoint = yield* sourceCheckpoint(ctx, projection);
	const current = yield* Schema.decodeUnknownEffect(
		Schema.Struct({
			database_guid: Schema.String,
			recovery_fork_guid: Schema.String,
			maximum: Rowversion,
			observed_at: Schema.String,
			metadata: Schema.fromJsonString(
				Schema.Array(
					Schema.Struct({
						alias: Schema.String,
						column: Schema.NullOr(Schema.String),
						object_id: Schema.Int,
						created: Schema.String,
						rowversion_type: Schema.NullOr(Schema.Int)
					})
				)
			)
		})
	)(checkpoint[0]).pipe(
		Effect.mapError((cause) => new SourceUnavailable({ reason: String(cause) }))
	);
	const { metadata } = current;
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
	if (!Number.isFinite(Date.parse(current.observed_at)))
		return yield* new SourceUnavailable({ reason: 'The SQL Server clock is unavailable' });
	return {
		account: `${current.database_guid}/${current.recovery_fork_guid}`.toLowerCase(),
		source: yield* sha256Hex(
			JSON.stringify([current.database_guid, current.recovery_fork_guid, metadata, projection])
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
type Reconciler<R extends object> = (after: string) => Effect.Effect<
	{
		readonly rows: readonly (R & { readonly $id: string })[];
		readonly after: string;
		readonly more: boolean;
	},
	FacilityFailure | Unavailable | SourceRowInvalid | ReadFailed
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
	build: (row: SqlRow, observedAt: string) => R,
	reconcile?: Reconciler<M>,
	account?: string
): Effect.fn.Return<
	SourcePage<R | M>,
	| ReadFailed
	| FacilityFailure
	| Unavailable
	| SourceRowInvalid
	| SourceUnavailable
	| CheckpointInvalid
	| DigestUnavailable
> {
	const current = yield* sourceState(ctx, projection);
	if (account !== undefined && current.account !== account)
		return yield* new SourceUnavailable({
			reason: 'The verified Kingdee read account identity does not match'
		});
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
			Duration.toMillis(Duration.minutes(ctx.configuration.fullSnapshotMinutes));
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
		Duration.toMillis(Duration.minutes(ctx.configuration.maxWindowMinutes))
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
	if (
		position.mode === 'changes' &&
		state.continuation === null &&
		position.upper === state.bookmark
	)
		return { rows: [], cursor: state, more: false, health };
	const result = yield* sourcePage(ctx, projection, {
		after: position.after,
		window: position.mode === 'changes' ? { from: state.bookmark, to: position.upper } : undefined,
		account
	});
	const binding = EffectRecord.keys(bindings).find((name) => bindings[name] === projection);
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
						: normalizeSourceRow(binding, row, ctx.configuration, current.now),
					current.now
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

/** A read's rows name the account they came from: a sync stamps no reference itself. */
export const fromSource = <P extends { readonly rows: readonly object[] }>(
	page: P,
	instance: InstanceId<'kingdee'>
) => ({ ...page, rows: page.rows.map((row) => ({ ...row, source: instance })) });
