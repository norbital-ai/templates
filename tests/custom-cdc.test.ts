import { sha256Hex } from '../src/lib/commercial.js';
import { Effect, Schema } from 'effect';
import { expect, it as test } from '@effect/vitest';
type Json = Schema.Schema.Type<typeof Schema.Json>;
import { columns, readCdc, type SqlRow } from '../src/integration/kingdee/cdc.js';
import { projections } from '../src/integration/kingdee/projections.js';
import type { ConfigurationOf } from '@norbital-ai/bolt';
import type { DatabaseRequest } from '@norbital-ai/bolt/engine';
import { submitOrder } from '../src/integration/kingdee/submission.js';
const Request = Schema.Struct({
	statement: Schema.String,
	parameters: Schema.Record(
		Schema.String,
		Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])
	)
});
const lsn = (number: number) => '0x' + number.toString(16).padStart(20, '0');
const feed = projections.source_payments;
const defaults = { maxLagMinutes: 15, retentionMinutes: 4320, minRetentionMinutes: 15 };
const row = (value: SqlRow) => value;
function fixture({
	rows = [],
	minimum = 1,
	maximum = 10,
	lag = 1000,
	age = 0,
	fork = 'fork-a'
}: {
	rows?: Record<string, Json>[];
	minimum?: number;
	maximum?: number;
	lag?: number;
	age?: number;
	fork?: string;
} = {}) {
	const calls: Schema.Schema.Type<typeof Request>[] = [];
	return {
		calls,
		configuration: defaults,
		request: Effect.fnUntraced(function* (value: unknown) {
			const request = Schema.decodeUnknownSync(Request)(value);
			calls.push(request);
			if (request.statement.includes('FROM cdc.change_tables'))
				return {
					rows: [
						{
							capture_instance: 'colony_source_payments',
							object_id: 10,
							created: '2026-10-13',
							minimum: lsn(minimum)
						}
					]
				};
			if (request.statement.includes('sys.database_recovery_status'))
				return { rows: [{ database_guid: 'db-a', recovery_fork_guid: fork }] };
			if (request.statement.includes('SELECT sys.fn_cdc_get_max_lsn()'))
				return { rows: [{ maximum: lsn(maximum), lag: String(lag) }] };
			if (request.statement.includes(' AS age')) return { rows: [{ age: String(age) }] };
			return { rows };
		})
	};
}
test.live(
	'snapshot pages preserve baseline, printable key ordering and exact decimal strings',
	() =>
		Effect.gen(function* () {
			const first = fixture({
				rows: Array.from({ length: 1000 }, (_, i) => ({
					__key: `PAY-${String(i).padStart(4, '0')}`,
					external_code: `PAY-${i}`,
					amount: '9007199254740993.1234'
				}))
			});
			const page = yield* readCdc(feed, 'external_code', null, first, row);
			expect(page.changes).toHaveLength(999);
			expect(page).toMatchObject({
				more: true,
				cursor: {
					checkpoint: null,
					continuation: { lsn: '0000000000000000000a', key: 'PAY-0998', stage: 'snapshot' },
					snapshot: true
				}
			});
			expect(page.changes[0]).toMatchObject({ upsert: { amount: '9007199254740993.1234' } });
			expect(first.calls.at(-1)?.statement).toContain('CONVERT(varchar(100),[amount])');
			const next = fixture({ rows: [{ __key: 'PAY-0999', amount: '1.0000' }], maximum: 20 });
			const end = yield* readCdc(feed, 'external_code', page.cursor, next, row);
			expect(next.calls.at(-1)?.parameters).toEqual({ after_key: 'PAY-0998' });
			expect(end).toMatchObject({
				more: false,
				snapshot: 'end',
				cursor: {
					checkpoint: { lsn: '0000000000000000000a', stage: 'changes' },
					continuation: null
				}
			});
		})
);
test.live('delta resumes the inclusive LSN tuple and fixes the upper bound across pages', () =>
	Effect.gen(function* () {
		const baseline = yield* readCdc(feed, 'external_code', null, fixture(), row);
		const changes = Array.from({ length: 1000 }, (_, i) => ({
			__key: `PAY-${i}`,
			__event_key: `PAY-${i}`,
			__$start_lsn: lsn(11),
			__$seqval: lsn(i + 1),
			__$operation: 4,
			amount: '1.23'
		}));
		const context = fixture({ rows: changes, maximum: 20 });
		const page = yield* readCdc(feed, 'external_code', baseline.cursor, context, row);
		expect(page).toMatchObject({
			more: true,
			cursor: { continuation: { upper: '00000000000000000014', seq: '000000000000000003e7' } }
		});
		const next = fixture({ maximum: 30 });
		const final = yield* readCdc(feed, 'external_code', page.cursor, next, row);
		expect(next.calls.at(-1)?.parameters.to_lsn_hex).toBe(lsn(20));
		expect(final).toMatchObject({
			more: false,
			cursor: { checkpoint: { lsn: '00000000000000000014' }, continuation: null }
		});
		expect(final.snapshot).toBeUndefined();
	})
);
test.live(
	'source restore and cleanup gaps require fresh snapshots instead of missing changes',
	() =>
		Effect.gen(function* () {
			const baseline = yield* readCdc(feed, 'external_code', null, fixture(), row);
			expect(
				yield* readCdc(feed, 'external_code', baseline.cursor, fixture({ fork: 'fork-b' }), row)
			).toMatchObject({ retained: false, changes: [] });
			expect(
				yield* readCdc(
					feed,
					'external_code',
					baseline.cursor,
					fixture({ minimum: 11, maximum: 20 }),
					row
				)
			).toMatchObject({ retained: false, changes: [] });
		})
);
test.live(
	'missing captures, binary positions and imprecise amounts fail before model data is returned',
	() =>
		Effect.gen(function* () {
			expect(
				yield* Effect.flip(readCdc(feed, 'external_code', null, fixture({ minimum: 0 }), row))
			).toMatchObject({
				_tag: 'CdcClockUnavailable',
				reason: 'A selected CDC capture is missing or inaccessible'
			});
			expect(
				yield* Effect.flip(
					readCdc(feed, 'external_code', null, fixture({ rows: [{ __key: 'bad key' }] }), row)
				)
			).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: '__key',
				reason: 'Projection requires a stable printable key'
			});
			expect(
				yield* Effect.flip(
					readCdc(
						feed,
						'external_code',
						null,
						fixture({ rows: [{ __key: 'PAY-1', amount: 1.23 }] }),
						(value) => columns(value).decimal('amount')
					)
				)
			).toMatchObject({
				_tag: 'SourceRowInvalid',
				column: 'amount',
				reason: 'Precise amounts must be projected as text'
			});
		})
);
test.live('CDC delete rows stay tombstones keyed by the remote identity', () =>
	Effect.gen(function* () {
		const baseline = yield* readCdc(feed, 'external_code', null, fixture(), row),
			context = fixture({
				maximum: 20,
				rows: [
					{
						__key: 'PAY-1',
						__event_key: 'PAY-1',
						__$start_lsn: lsn(11),
						__$seqval: lsn(1),
						__$operation: 1
					}
				]
			});
		expect((yield* readCdc(feed, 'external_code', baseline.cursor, context, row)).changes).toEqual([
			{ delete: { external_code: 'PAY-1' } }
		]);
	})
);
test.live('health limits come only from the instance configuration', () =>
	Effect.gen(function* () {
		// @ts-expect-error a stored configuration holds every defaulted limit (each write is decoded against the definition)
		const unset: ConfigurationOf<'kingdee'> = {};
		void unset;
		expect(
			yield* readCdc(feed, 'external_code', null, fixture({ lag: 120000 }), row)
		).toMatchObject({
			health: { state: 'ready' }
		});
		expect(
			yield* readCdc(
				feed,
				'external_code',
				null,
				{ ...fixture({ lag: 120000 }), configuration: { ...defaults, maxLagMinutes: 1 } },
				row
			)
		).toMatchObject({ health: { state: 'attention', code: 'captureLag' } });
	})
);
const payload = {
	order_id: 'order-a',
	reference: 'SO-1',
	direction: 'sales',
	agreement_hash: 'seal',
	currency: 'SGD',
	party_code: 'customer',
	agreement: '{}',
	contract: 'contract',
	items: '<items/>'
};
test.live(
	'outbound header/items, keyed lock, verification and acknowledgement share one serializable source batch',
	() =>
		Effect.gen(function* () {
			let operation: Json = null;
			const remote = yield* submitOrder(payload, 'immutable-key', {
				request: Effect.fnUntraced(function* (input: DatabaseRequest) {
					operation = input;
					return { rows: [{ remote: 'source-a', hash: String(input.parameters.hash) }] };
				})
			});
			expect(remote).toBe('source-a');
			expect(operation).toMatchObject({
				transaction: 'serializable',
				maxRows: 1,
				parameters: { key: 'immutable-key', hash: yield* sha256Hex(JSON.stringify(payload)) }
			});
			const request = Schema.decodeUnknownSync(Request)(operation);
			expect(request.statement).toContain('sys.sp_getapplock');
			expect(request.statement).toContain('INSERT colony.OrderItem');
			expect(request.statement).toContain('EXEC colony.ApproveOrder');
			expect(request.statement).toContain('submission_hash<>@hash');
		})
);
test.live(
	'the submission fingerprint is the agreement, not the order its payload keys arrive in',
	() =>
		Effect.gen(function* () {
			const hashes: string[] = [];
			const ctx = {
				request: Effect.fnUntraced(function* (input: DatabaseRequest) {
					hashes.push(String(input.parameters.hash));
					return { rows: [{ remote: 'source-a', hash: String(input.parameters.hash) }] };
				})
			};
			yield* submitOrder(payload, 'immutable-key', ctx);
			yield* submitOrder(
				Object.fromEntries(Object.entries(payload).reverse()),
				'immutable-key',
				ctx
			);
			expect(hashes).toHaveLength(2);
			expect(hashes[1]).toBe(hashes[0]);
		})
);
test.live('an invalid payload or a mismatched acknowledgement cannot confirm the submission', () =>
	Effect.gen(function* () {
		let calls = 0;
		const ctx = {
			request: Effect.fnUntraced(function* () {
				calls++;
				return { rows: [{ remote: 'source-a', hash: 'c'.repeat(64) }] };
			})
		};
		expect(
			yield* Effect.flip(submitOrder({ ...payload, direction: 'other' }, 'key', ctx))
		).toMatchObject({
			_tag: 'SourceRowInvalid',
			column: '$row',
			reason: expect.stringContaining('direction')
		});
		expect(calls).toBe(0);
		expect(yield* Effect.flip(submitOrder(payload, 'key', ctx))).toMatchObject({
			_tag: 'SourceRowInvalid',
			column: '$receipt',
			reason: 'Source receipt does not match the immutable submission'
		});
	})
);
test.live('source-configured lag and retention warnings retain ordinary snapshot records', () =>
	Effect.gen(function* () {
		const delayed = yield* readCdc(
			feed,
			'external_code',
			null,
			fixture({ lag: 1000000, rows: [{ __key: 'PAY-1', amount: '1' }] }),
			row
		);
		expect(delayed).toMatchObject({ health: { state: 'attention', code: 'captureLag' } });
		expect(delayed.retained).toBeUndefined();
		expect(delayed.changes).toHaveLength(1);
		const risk = yield* readCdc(
			feed,
			'external_code',
			null,
			{
				...fixture({ age: 61000 }),
				configuration: { maxLagMinutes: 15, retentionMinutes: 1, minRetentionMinutes: 1 }
			},
			row
		);
		expect(risk).toMatchObject({ health: { state: 'attention', code: 'retentionRisk' } });
		expect(risk.retained).toBeUndefined();
	})
);
