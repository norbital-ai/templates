import { Effect, Result, Schema } from 'effect';
import type { FacilityFailure, Unavailable } from '@norbital-ai/bolt/errors';
import { sha256Hex, type DigestUnavailable } from '../../lib/commercial.js';
import type { ConfigurationOf, FeedPage, Id } from '@norbital-ai/bolt';
import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { inputSchema } from '@norbital-ai/std/kind';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import type { Projection } from './projections.js';
export class SourceRowInvalid extends Schema.TaggedError<SourceRowInvalid>()('SourceRowInvalid', {
	column: Schema.String,
	reason: Schema.String
}) {}
export class CdcClockUnavailable extends Schema.TaggedError<CdcClockUnavailable>()(
	'CdcClockUnavailable',
	{ reason: Schema.String }
) {}
class CheckpointInvalid extends Schema.TaggedError<CheckpointInvalid>()('CheckpointInvalid', {
	reason: Schema.String
}) {}
const ZERO = '00000000000000000000',
	END = 'ffffffffffffffffffff',
	PAGE = 999;
const Position = Schema.Struct({
	source: Schema.String,
	lsn: Schema.String,
	seq: Schema.String,
	op: Schema.Number,
	key: Schema.String,
	stage: Schema.Literals(['snapshot', 'changes']),
	upper: Schema.String
});
type Position = Schema.Schema.Type<typeof Position>;
const Cursor = Schema.Struct({
	checkpoint: Schema.Json,
	continuation: Schema.Json,
	snapshot: Schema.Boolean
});
const SqlResult = Schema.Struct({ rows: Schema.Array(Schema.Record(Schema.String, Schema.Json)) });
/** An instance's live SQL request (the read and run ctx's `request`). */
export type DatabaseContext = {
	request: (op: DatabaseRequest) => Effect.Effect<DatabaseResult, FacilityFailure | Unavailable>;
};
/** One row of a projection as SQL Server answered it. */
export type SqlRow = {
	readonly [column: string]: Json;
};
export const query = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	statement: string,
	parameters: Record<string, string | number | boolean | null> = {}
) {
	return (yield* Schema.decodeUnknownEffect(SqlResult)(
		yield* ctx.request({ statement, parameters, maxRows: 1000 })
	).pipe(
		Effect.mapError((cause) => new SourceRowInvalid({ column: '$result', reason: String(cause) }))
	)).rows;
});
const BinaryPosition = Schema.String.check(Schema.isPattern(/^0x[a-f0-9]{20}$/i));
const PrintableKey = Schema.String.check(Schema.isPattern(/^[\x21-\x7e]{1,512}$/));
const ClockMilliseconds = Schema.Union([Schema.Int, Schema.NumberFromString.check(Schema.isInt())]);
const hex = (value: Json | undefined): string =>
	Schema.decodeUnknownSync(BinaryPosition)(value).slice(2).toLowerCase();
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
 * A SQL row's columns as feed values. A NULL column answers its fallback, or fails without one; a value of another wire
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
const clock = Effect.fnUntraced(function* (ctx: DatabaseContext, feed: Projection) {
	const parameters = Object.fromEntries(
		feed.captures.map((capture, i) => [`capture${i}`, capture])
	);
	const captures = yield* query(
		ctx,
		`SELECT ct.capture_instance,ct.object_id,CONVERT(varchar(33),obj.create_date,121) AS created,sys.fn_cdc_get_min_lsn(ct.capture_instance) AS minimum
	 FROM cdc.change_tables ct JOIN sys.objects obj ON obj.object_id=ct.object_id
	 WHERE ct.capture_instance IN (${feed.captures.map((_capture, i) => `@capture${i}`).join(',')}) ORDER BY ct.capture_instance`,
		parameters
	);
	const verifiedCaptures = yield* Schema.decodeUnknownEffect(
		Schema.Array(
			Schema.Struct({
				capture_instance: Schema.String,
				object_id: Schema.Int,
				created: Schema.String,
				minimum: BinaryPosition
			})
		)
	)(captures).pipe(Effect.mapError((cause) => new CdcClockUnavailable({ reason: String(cause) })));
	if (
		verifiedCaptures.length !== feed.captures.length ||
		verifiedCaptures.some((row) => hex(row.minimum) === ZERO)
	)
		return yield* Effect.fail(
			new CdcClockUnavailable({ reason: 'A selected CDC capture is missing or inaccessible' })
		);
	const [database] = yield* query(
		ctx,
		'SELECT database_guid,recovery_fork_guid FROM sys.database_recovery_status WHERE database_id=DB_ID()'
	);
	const identity = yield* Schema.decodeUnknownEffect(
		Schema.Struct({ database_guid: Schema.String, recovery_fork_guid: Schema.String })
	)(database).pipe(Effect.mapError((cause) => new CdcClockUnavailable({ reason: String(cause) })));
	const source = yield* sha256Hex(
		JSON.stringify([
			identity.database_guid,
			identity.recovery_fork_guid,
			verifiedCaptures.map((row) => [row.capture_instance, row.object_id, row.created])
		])
	);
	const [latest] = yield* query(
		ctx,
		'SELECT sys.fn_cdc_get_max_lsn() AS maximum,CAST(DATEDIFF(second,sys.fn_cdc_map_lsn_to_time(sys.fn_cdc_get_max_lsn()),GETDATE()) AS bigint)*1000 AS lag'
	);
	const latestClock = yield* Schema.decodeUnknownEffect(
		Schema.Struct({ maximum: BinaryPosition, lag: ClockMilliseconds })
	)(latest).pipe(Effect.mapError((cause) => new CdcClockUnavailable({ reason: String(cause) })));
	const maximum = hex(latestClock.maximum);
	if (maximum === ZERO)
		return yield* Effect.fail(
			new CdcClockUnavailable({ reason: 'CDC capture clock is unavailable' })
		);
	return {
		source,
		maximum,
		lagMs: Math.max(0, latestClock.lag),
		minimum: verifiedCaptures.map((row) => hex(row.minimum))
	};
});
const saved = Effect.fnUntraced(function* (value: Json) {
	const result = yield* Schema.decodeUnknownEffect(Position)(value).pipe(
		Effect.mapError((cause) => new CheckpointInvalid({ reason: String(cause) }))
	);
	if (
		![result.lsn, result.seq, result.upper].every((value) => /^[a-f0-9]{20}$/.test(value)) ||
		![0, 1, 2, 4, 99].includes(result.op) ||
		(result.key !== '' && key(result.key) !== result.key)
	)
		return yield* Effect.fail(new CheckpointInvalid({ reason: 'Invalid CDC checkpoint' }));
	return result;
});
function select(feed: Projection, delta: boolean) {
	return [
		'__key',
		...(delta ? ['__event_key', '__$start_lsn', '__$seqval', '__$operation'] : []),
		...feed.columns.map((name) =>
			feed.decimals?.includes(name)
				? `CONVERT(varchar(100),[${name}]) AS [${name}]`
				: feed.dates?.includes(name)
					? `CONVERT(varchar(10),[${name}],23) AS [${name}]`
					: `[${name}]`
		)
	].join(',');
}
/**
 * One feed page of a projection: a snapshot from no cursor, then CDC deltas. SQL Server owns the ordered tuples; the
 * engine commits the page's rows with its cursor, so a page it refuses acknowledges nothing. `build` turns each upserted
 * SQL row into the feed's row; a delete names the remote `key`.
 */
export const readCdc = Effect.fnUntraced(function* <const K extends string, R>(
	feed: Projection,
	identity: K,
	cursor: Json | null,
	ctx: DatabaseContext & {
		readonly configuration: ConfigurationOf<'kingdee'>;
	},
	build: (row: SqlRow) => R
): Effect.fn.Return<
	FeedPage<R, { readonly [P in K]: string }>,
	| FacilityFailure
	| Unavailable
	| SourceRowInvalid
	| CdcClockUnavailable
	| CheckpointInvalid
	| DigestUnavailable
> {
	const state =
		cursor === null
			? { checkpoint: null, continuation: null, snapshot: true }
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
					Effect.mapError((cause) => new CheckpointInvalid({ reason: String(cause) }))
				);
	const settings = ctx.configuration;
	const current = yield* clock(ctx, feed);
	const previous =
		state.continuation === null
			? state.checkpoint === null
				? null
				: yield* saved(state.checkpoint)
			: yield* saved(state.continuation);
	let position: Position = previous ?? {
		source: current.source,
		lsn: current.maximum,
		seq: ZERO,
		op: 0,
		key: '',
		stage: state.snapshot ? 'snapshot' : 'changes',
		upper: current.maximum
	};
	if (
		position.source !== current.source ||
		current.minimum.some((minimum) => minimum > position.lsn)
	)
		return { changes: [], cursor: null, more: false, retained: false };
	if (current.maximum < position.lsn || current.maximum < position.upper)
		return yield* Effect.fail(
			new CheckpointInvalid({ reason: 'CDC maximum moved behind the saved checkpoint' })
		);
	if (position.stage !== (state.snapshot ? 'snapshot' : 'changes'))
		return yield* Effect.fail(
			new CheckpointInvalid({ reason: 'CDC read mode does not match its checkpoint' })
		);
	if (!state.snapshot && state.continuation === null)
		position = { ...position, upper: current.maximum };
	const [age] = yield* query(
		ctx,
		'SELECT CAST(DATEDIFF(second,sys.fn_cdc_map_lsn_to_time(CONVERT(binary(10),@baseline_hex,1)),GETDATE()) AS bigint)*1000 AS age',
		{ baseline_hex: `0x${position.lsn}` }
	);
	const checkpointClock = yield* Schema.decodeUnknownEffect(
		Schema.Struct({ age: ClockMilliseconds })
	)(age).pipe(Effect.mapError((cause) => new CdcClockUnavailable({ reason: String(cause) })));
	const remaining = Math.max(
		0,
		settings.retentionMinutes * 60000 - Math.max(0, checkpointClock.age)
	);
	const health =
		remaining < settings.minRetentionMinutes * 60000
			? { state: 'attention' as const, code: 'retentionRisk' }
			: current.lagMs > settings.maxLagMinutes * 60000
				? { state: 'attention' as const, code: 'captureLag' }
				: { state: 'ready' as const };
	const parameters = state.snapshot
		? { after_key: position.key }
		: {
				from_lsn_hex: `0x${position.lsn}`,
				to_lsn_hex: `0x${position.upper}`,
				after_seq_hex: `0x${position.seq}`,
				after_op: position.op,
				after_key: position.key
			};
	const statement = state.snapshot
		? `SELECT TOP (1000) ${select(feed, false)} FROM (${feed.snapshot}) AS projection
	 WHERE __key COLLATE Latin1_General_BIN2 > @after_key COLLATE Latin1_General_BIN2 ORDER BY __key COLLATE Latin1_General_BIN2`
		: `DECLARE @from_lsn binary(10)=CONVERT(binary(10),@from_lsn_hex,1),@to_lsn binary(10)=CONVERT(binary(10),@to_lsn_hex,1),@after_seq binary(10)=CONVERT(binary(10),@after_seq_hex,1);
	 SELECT TOP (1000) ${select(feed, true)} FROM (${feed.changes}) AS projection WHERE
	 __$start_lsn>@from_lsn OR (__$start_lsn=@from_lsn AND (__$seqval>@after_seq OR (__$seqval=@after_seq AND (__$operation>@after_op OR
	 (__$operation=@after_op AND __event_key COLLATE Latin1_General_BIN2>@after_key COLLATE Latin1_General_BIN2)))))
	 ORDER BY __$start_lsn,__$seqval,__$operation,__event_key COLLATE Latin1_General_BIN2`;
	const rows = yield* query(ctx, statement, parameters),
		changes: (
			| {
					upsert: R;
			  }
			| {
					delete: {
						readonly [P in K]: string;
					};
			  }
		)[] = [];
	const decoded = yield* Effect.try({
		try: () =>
			rows.slice(0, PAGE).map((row) => ({
				row,
				remote: key(row['__key']),
				change:
					!state.snapshot && row['__$operation'] === 1
						? { kind: 'delete' as const }
						: { kind: 'upsert' as const, value: build(row) },
				lsn: state.snapshot ? position.lsn : hex(row['__$start_lsn']),
				seq: state.snapshot ? position.seq : hex(row['__$seqval']),
				eventKey: state.snapshot ? key(row['__key']) : key(row['__event_key'])
			})),
		catch: (cause) =>
			cause instanceof SourceRowInvalid
				? cause
				: new SourceRowInvalid({ column: '$row', reason: String(cause) })
	});
	for (const { row, remote, change, lsn, seq, eventKey } of decoded) {
		if (state.snapshot) {
			position = { ...position, key: remote };
			if (change.kind === 'upsert') changes.push({ upsert: change.value });
		} else {
			const operation = row['__$operation'];
			if (operation !== 1 && operation !== 2 && operation !== 4)
				return yield* Effect.fail(
					new SourceRowInvalid({
						column: '__$operation',
						reason: 'CDC projection requires delete, insert or update-after rows'
					})
				);
			position = {
				...position,
				lsn,
				seq,
				op: operation,
				key: eventKey
			};
			changes.push(
				change.kind === 'delete'
					? {
							delete: Schema.decodeUnknownSync(
								Schema.Record(Schema.Literals([identity]), Schema.String)
							)({ [identity]: remote })
						}
					: { upsert: change.value }
			);
		}
	}
	if (rows.length > PAGE)
		return {
			changes,
			cursor: { checkpoint: state.checkpoint, continuation: position, snapshot: state.snapshot },
			more: true,
			health
		};
	return {
		changes,
		cursor: {
			checkpoint: { ...position, stage: 'changes', lsn: position.upper, seq: END, op: 99, key: '' },
			continuation: null,
			snapshot: false
		},
		more: false,
		...(state.snapshot ? { snapshot: 'end' as const } : {}),
		health
	};
});
