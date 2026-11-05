import { Effect, Schema } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { columns, readSource, type SqlRow } from '../src/integration/kingdee/polling.js';
import type { Projection } from '../src/integration/kingdee/projections.js';
import { DatabaseRequest } from '@norbital-ai/bolt/engine';
import { sourcePage, sourceKeys } from '../src/integration/kingdee/sql.js';
type Json = Schema.Schema.Type<typeof Schema.Json>;
const rv = (value: number) => '0x' + value.toString(16).padStart(16, '0');
const source: Projection = {
	table: { schema: 'dbo', name: 'Probe' },
	alias: 'probe',
	key: 'external_code',
	columns: ['external_code', 'amount'],
	rowversion: 'source_version'
};
const snapshotSource: Projection = {
	table: source.table,
	alias: 'probe',
	key: source.key,
	columns: source.columns
};
const defaults = {
	fullSnapshotMinutes: 1440,
	maxWindowMinutes: 15,
	baseCurrency: 'CNY',
	branchNo: '0'
};
const row = (value: SqlRow) => value;
function argumentsOf(request: DatabaseRequest | undefined) {
	if (
		request?.op !== 'call' ||
		request.procedure.schema !== 'sys' ||
		request.procedure.name !== 'sp_executesql'
	)
		throw new Error('A native parameterized SQL call is required');
	return request.arguments;
}
function kind(request: DatabaseRequest) {
	const stmt = argumentsOf(request).stmt;
	if (typeof stmt !== 'string') throw new Error('SQL text is required');
	if (stmt.includes('sys.database_recovery_status')) return 'identity';
	if (stmt.includes('MIN_ACTIVE_ROWVERSION()')) return 'clock';
	if (stmt.includes('sys.objects')) return 'metadata';
	return 'page';
}
function fixture({
	rows = [],
	maximum = 10,
	now = '2026-10-26T00:00:00.000Z',
	fork = 'fork-a',
	marker = 189
}: {
	rows?: Record<string, Json>[];
	maximum?: number;
	now?: string;
	fork?: string;
	marker?: number | null;
} = {}) {
	const calls: DatabaseRequest[] = [];
	return {
		calls,
		configuration: defaults,
		request: Effect.fnUntraced(function* (value: unknown) {
			const request = Schema.decodeUnknownSync(DatabaseRequest)(value);
			calls.push(request);
			const operation = kind(request);
			if (operation === 'identity')
				return { rows: [{ database_guid: 'db-a', recovery_fork_guid: fork }] };
			if (operation === 'metadata') {
				const versioned = Object.values(argumentsOf(request)).includes('source_version');
				return {
					rows: [
						{
							alias: 'probe',
							column: versioned ? 'source_version' : null,
							object_id: 10,
							created: '2026-10-01',
							rowversion_type: versioned ? marker : null
						}
					]
				};
			}
			if (operation === 'clock') return { rows: [{ maximum: rv(maximum), observed_at: now }] };
			return { rows };
		})
	};
}
const baseline = Effect.fnUntraced(function* () {
	const first = yield* readSource(source, null, fixture(), row);
	return yield* readSource(source, first.cursor, fixture(), row);
});
test.effect(
	'a full scan starts a cycle and only its completed terminal page advances the bookmark',
	() =>
		Effect.gen(function* () {
			const first = fixture({
				rows: Array.from({ length: 1000 }, (_, i) => ({
					__key: `P-${String(i).padStart(4, '0')}`,
					__rowversion: rv(i + 1),
					amount: '9007199254740993.1234'
				}))
			});
			const page = yield* readSource(source, null, first, row);
			expect(page.rows).toHaveLength(999);
			expect(page).toMatchObject({
				snapshot: 'begin',
				more: true,
				cursor: {
					bookmark: rv(0),
					continuation: { upper: rv(10), after: 'P-0998', mode: 'snapshot' }
				}
			});
			expect(page.rows[0]).toMatchObject({ $id: 'P-0000', amount: '9007199254740993.1234' });
			expect(page.rows[0]).not.toHaveProperty('$version');
			const next = fixture({ maximum: 2000, rows: [{ __key: 'P-0999', __rowversion: rv(1000) }] });
			const last = yield* readSource(source, page.cursor, next, row);
			expect(argumentsOf(next.calls.at(-1))).toMatchObject({ after: 'P-0998' });
			expect(last).toMatchObject({
				more: true,
				cursor: { bookmark: rv(0), continuation: { mode: 'finish', upper: rv(10) } }
			});
			const end = yield* readSource(source, last.cursor, fixture({ maximum: 3000 }), row);
			expect(end).toMatchObject({
				rows: [],
				more: false,
				snapshot: 'end',
				cursor: { bookmark: rv(10), continuation: null }
			});
		})
);
test.effect(
	'incremental pages keep the safe exclusive upper bound even when the server advances',
	() =>
		Effect.gen(function* () {
			const start = yield* baseline();
			const context = fixture({
				maximum: 2000,
				rows: Array.from({ length: 1000 }, (_, i) => ({
					__key: `P-${String(i).padStart(4, '0')}`,
					__rowversion: rv(i + 11)
				}))
			});
			const page = yield* readSource(source, start.cursor, context, row);
			expect(context.calls.map(kind)).toEqual(['identity', 'metadata', 'clock', 'page']);
			expect(argumentsOf(context.calls.at(-1))).toMatchObject({ from: rv(10), to: rv(2000) });
			expect(page.cursor).toMatchObject({ bookmark: rv(10), continuation: { upper: rv(2000) } });
			const next = fixture({ maximum: 3000, rows: [{ __key: 'P-0999', __rowversion: rv(1010) }] });
			const end = yield* readSource(source, page.cursor, next, row);
			expect(argumentsOf(next.calls.at(-1))).toMatchObject({
				from: rv(10),
				to: rv(2000),
				after: 'P-0998'
			});
			expect(end).toMatchObject({
				more: false,
				cursor: { bookmark: rv(2000), continuation: null }
			});
			expect(end.snapshot).toBeUndefined();
		})
);
test.effect('empty incremental windows advance without fabricating deletes', () =>
	Effect.gen(function* () {
		const start = yield* baseline();
		const page = yield* readSource(source, start.cursor, fixture({ maximum: 20 }), row);
		expect(page).toMatchObject({ rows: [], more: false, cursor: { bookmark: rv(20) } });
		expect(page.snapshot).toBeUndefined();
	})
);
test.effect(
	'scheduled full reconciliation begins a new cycle and ignores the incremental range',
	() =>
		Effect.gen(function* () {
			const start = yield* baseline();
			const ctx = fixture({ maximum: 30, now: '2026-10-27T00:00:00.000Z' });
			const page = yield* readSource(source, start.cursor, ctx, row);
			expect(page).toMatchObject({ snapshot: 'begin', more: true });
			expect(ctx.calls.map(kind).at(-1)).toBe('page');
			expect(argumentsOf(ctx.calls.at(-1))).not.toHaveProperty('from');
			const end = yield* readSource(source, page.cursor, ctx, row);
			expect(end).toMatchObject({
				snapshot: 'end',
				more: false,
				cursor: { bookmark: rv(30), fullAt: '2026-10-27T00:00:00.000Z' }
			});
		})
);
test.effect('feeds without reliable markers use a complete listing on every poll', () =>
	Effect.gen(function* () {
		const ctx = fixture();
		const begin = yield* readSource(snapshotSource, null, ctx, row);
		const end = yield* readSource(snapshotSource, begin.cursor, ctx, row);
		const again = yield* readSource(snapshotSource, end.cursor, ctx, row);
		expect(again.snapshot).toBe('begin');
		expect(
			ctx.calls.filter((x) => kind(x) === 'page').every((x) => argumentsOf(x).from === undefined)
		).toBe(true);
	})
);
test.effect(
	'a changed source or regressed version fails without resetting or acknowledging its bookmark',
	() =>
		Effect.gen(function* () {
			const start = yield* baseline();
			expect(
				yield* Effect.flip(readSource(source, start.cursor, fixture({ fork: 'different' }), row))
			).toMatchObject({ _tag: 'CheckpointInvalid' });
			expect(
				yield* Effect.flip(readSource(source, start.cursor, fixture({ maximum: 5 }), row))
			).toMatchObject({ _tag: 'CheckpointInvalid' });
		})
);
test.effect(
	'declared markers must be native rowversions and malformed source pages acknowledge nothing',
	() =>
		Effect.gen(function* () {
			expect(
				yield* Effect.flip(readSource(source, null, fixture({ marker: 61 }), row))
			).toMatchObject({ _tag: 'SourceUnavailable' });
			expect(
				yield* Effect.flip(
					readSource(
						source,
						null,
						fixture({ rows: [{ __key: 'bad key', __rowversion: rv(1) }] }),
						row
					)
				)
			).toMatchObject({ _tag: 'SourceRowInvalid', column: '__key' });
			expect(
				yield* Effect.flip(
					readSource(
						source,
						null,
						fixture({ rows: [{ __key: 'P-1', __rowversion: rv(1), amount: 1.23 }] }),
						(r) => ({ amount: columns(r).decimal('amount') })
					)
				)
			).toMatchObject({ _tag: 'SourceRowInvalid', column: 'amount' });
			const start = yield* baseline();
			expect(
				yield* Effect.flip(
					readSource(
						source,
						start.cursor,
						fixture({ maximum: 20, rows: [{ __key: 'P-1', __rowversion: rv(20) }] }),
						row
					)
				)
			).toMatchObject({ _tag: 'SourceRowInvalid', column: '__rowversion' });
		})
);
test.effect('a malformed saved continuation cannot filter out source rows and advance', () =>
	Effect.gen(function* () {
		const first = yield* readSource(source, null, fixture(), row);
		const saved = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(first.cursor);
		const pending = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
			saved['continuation']
		);
		const malformed = { ...saved, continuation: { ...pending, after: 'bad key' } };
		const ctx = fixture();
		expect(yield* Effect.flip(readSource(source, malformed, ctx, row))).toMatchObject({
			_tag: 'CheckpointInvalid'
		});
		expect(ctx.calls.some((x) => kind(x) === 'page')).toBe(false);
	})
);
test.effect('source pages reject duplicate keys before a continuation can skip them', () =>
	Effect.gen(function* () {
		expect(
			yield* Effect.flip(
				readSource(
					source,
					null,
					fixture({
						rows: [
							{ __key: 'P-1', __rowversion: rv(1) },
							{ __key: 'P-1', __rowversion: rv(2) }
						]
					}),
					row
				)
			)
		).toMatchObject({ _tag: 'SourceRowInvalid', column: '__key' });
	})
);
test.effect('a duplicate on the lookahead boundary cannot be skipped by the next keyset page', () =>
	Effect.gen(function* () {
		const rows = Array.from({ length: 1000 }, (_, i) => ({
			__key: `P-${String(Math.min(i, 998)).padStart(4, '0')}`,
			__rowversion: rv(i + 1)
		}));
		expect(yield* Effect.flip(readSource(source, null, fixture({ rows }), row))).toMatchObject({
			_tag: 'SourceRowInvalid',
			column: '__key'
		});
	})
);
test.effect('a long running window reports its age while preserving the source read', () =>
	Effect.gen(function* () {
		const start = yield* readSource(source, null, fixture(), row);
		const end = yield* readSource(
			source,
			start.cursor,
			fixture({ now: '2026-10-26T00:16:00.000Z' }),
			row
		);
		expect(end).toMatchObject({ health: { state: 'attention', code: 'windowLag' } });
	})
);
test.effect(
	'joined rowversion queries bind the fixed window and source values through native SQL calls',
	() =>
		Effect.gen(function* () {
			const joined: Projection = {
				...source,
				rowversions: [
					{ tableAlias: 'probe', name: 'source_version' },
					{ tableAlias: 'detail', name: 'changed' }
				],
				joins: [
					{
						kind: 'left',
						table: { schema: 'dbo', name: 'Detail]Rows' },
						alias: 'detail',
						on: [
							{
								left: { tableAlias: 'probe', name: 'external_code' },
								right: { tableAlias: 'detail', name: 'owner' }
							}
						]
					}
				],
				filters: [
					{
						field: { tableAlias: 'probe', name: 'category' },
						op: 'in',
						value: ['SAFE', "O'Reilly"]
					}
				]
			};
			const ctx = fixture();
			yield* sourcePage(ctx, joined, 'P-0998', { from: rv(10), to: rv(2000) });
			const args = argumentsOf(ctx.calls.at(-1));
			expect(args).toMatchObject({ after: 'P-0998', from: rv(10), to: rv(2000) });
			expect(typeof args.stmt).toBe('string');
			expect(args.stmt).toContain('SELECT TOP 1000');
			expect(args.stmt).toContain('[dbo].[Detail]]Rows]');
			expect(args.stmt).toContain('CASE WHEN');
			expect(args.stmt).toContain('__rowversion >= CONVERT(binary(8),@from,1)');
			expect(args.stmt).toContain('__rowversion < CONVERT(binary(8),@to,1)');
			expect(args.stmt).not.toContain("O'Reilly");
			expect(Object.values(args)).toContain("O'Reilly");
		})
);
test.effect('absence verification binds XML identities without putting them into SQL text', () =>
	Effect.gen(function* () {
		const ctx = fixture();
		yield* sourceKeys(ctx, source, ['A&B<C>']);
		const args = argumentsOf(ctx.calls.at(-1));
		expect(args.keys).toBe('<keys><key>A&amp;B&lt;C&gt;</key></keys>');
		expect(args.stmt).toContain('DECLARE @source_keys xml');
		expect(args.stmt).toContain('varchar(4096)');
		expect(args.stmt).not.toContain('A&B<C>');
		expect(args.stmt).not.toContain('<keys>');
	})
);
