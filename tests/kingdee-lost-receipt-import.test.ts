import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { agreements, currentAgreement } from '../src/lib/agreements.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { workspace } from './kit.js';
import { sourceOrderSql } from '../src/integration/kingdee/submission.js';

it.live(
	'a lost initial SQL receipt followed by a Kingdee amendment adopts the same local SO by its sealed natural identity',
	() =>
		Effect.gen(function* () {
			const source = kingdeeFixture();
			const t = yield* workspace({ source: source.request });
			const own = yield* kingdeeSale(t, source);
			const initial = yield* t.as(t.admin).query('orders', { id: own.order });
			if (!initial?.source_order_key)
				throw new Error('The order needs its immutable birth identity');
			source.state.loseNextReceipt = true;
			yield* t.deliver();
			expect(source.state.lostReceipts).toBe(1);
			const original = source.tables.SEOrder?.[0];
			if (!original) throw new Error('SQL committed before its receipt was lost');
			const oldLines =
				source.tables.SEOrderEntry?.filter((line) => line.fid === original.fid) ?? [];
			const archive = '50001';
			source.tables.SEOrder?.push({
				...original,
				__key: archive.padStart(20, '0'),
				fid: archive,
				uuid: crypto.randomUUID(),
				archive: 1,
				cancelled: true,
				checker: '1',
				checked_on: '2026-10-10'
			});
			for (const [i, line] of oldLines.entries())
				source.tables.SEOrderEntry?.push({
					...line,
					fid: archive,
					__key: String(50001000 + i).padStart(20, '0'),
					detail_id: String(50001000 + i)
				});
			source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
				row === original
					? {
							...row,
							version: '001',
							checker: '1',
							checked_on: '2026-10-10',
							changed_at: '2026-10-10T01:00:00',
							changed_by: '1'
						}
					: row
			);
			source.tables.SEOrderEntry = (source.tables.SEOrderEntry ?? []).map((row) =>
				row.fid === original.fid
					? {
							...row,
							quantity: '12',
							unit_price: '3',
							unit_price_inclusive: '3.39',
							net_amount: '36',
							tax_amount: '4.68',
							gross_amount: '40.68'
						}
					: row
			);
			yield* t.pull('orders');
			const as = t.as(t.admin);
			const current = yield* as.query('orders', { id: own.order });
			if (!current) throw new Error('The existing local order must be adopted');
			expect(current.source_order_key).toBe(initial.source_order_key);
			expect(agreements(current)).toHaveLength(2);
			expect(currentAgreement(current)).toMatchObject({
				origin: 'kingdee',
				kingdee: { source_version: '001' },
				snapshot: { lines: [{ quantity: '12', unit_price: '3' }] }
			});
			expect((yield* as.query('orders', { all: true })).rows.map((row) => row.id)).toEqual([
				own.order
			]);
			const countWrites = () =>
				source.calls.filter(
					(request) => request.op === 'call' && request.arguments.stmt === sourceOrderSql
				).length;
			const beforeRetry = countWrites();
			t.clock.advance('10min');
			yield* t.deliver();
			expect(countWrites()).toBe(beforeRetry);
		})
);
