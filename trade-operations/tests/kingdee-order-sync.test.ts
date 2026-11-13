import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, workspace } from './kit.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { sameDecimal } from './test-runtime.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

/** A confirmed sale written to its SO, audited in Kingdee and read back on the order and its lines. */
const syncedSale = Effect.fnUntraced(function* () {
	const fixture = kingdeeFixture();
	const t = yield* workspace({ source: fixture.request });
	const as = yield* t.as(t.admin);
	const sale = yield* kingdeeSale(t, fixture);
	yield* t.deliver();
	const fid = [...fixture.submissions.values()].at(-1)?.remote;
	if (!fid) throw new Error('The writer must create the SO');
	fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
		row.fid === fid ? { ...row, checker: '701', checked_on: '2026-10-10' } : row
	);
	const pull = Effect.gen(function* () {
		yield* t.pull('orders');
		yield* t.pull('order_lines');
	});
	yield* pull;
	const read = () =>
		as.query({
			orders: { where: { id: { eq: sale.order } }, limit: 1 },
			order_lines: { where: { order: { eq: sale.order } } }
		});
	const entries = () => (fixture.tables.SEOrderEntry ?? []).filter((row) => row.fid === fid);
	const setEntries = (rows: readonly SqlRow[]) => {
		fixture.tables.SEOrderEntry = [
			...(fixture.tables.SEOrderEntry ?? []).filter((row) => row.fid !== fid),
			...rows
		];
	};
	return { t, as, sale, fixture, fid, pull, read, entries, setEntries };
});

it.live('a confirmed order writes its SO and reads its Kingdee state and line entries back', () =>
	Effect.gen(function* () {
		const { sale, fid, read } = yield* syncedSale();
		const { orders, order_lines } = yield* read();
		expect(orders.rows[0]).toMatchObject({
			status: 'confirmed',
			payment_terms: 'PROBE-NET30',
			kingdee: { fid, version: '000', status: 'issued', closed: false }
		});
		expect(order_lines.rows).toMatchObject([{ id: sale.line, source_entry_id: '1' }]);
		expect(sameDecimal(order_lines.rows[0]?.quantity, '10')).toBe(true);
	})
);

it.live('a Kingdee change to the SO lines updates, adds and removes the order lines', () =>
	Effect.gen(function* () {
		const { sale, pull, read, entries, setEntries } = yield* syncedSale();
		const [entry] = entries();
		if (!entry) throw new Error('SO entry required');
		setEntries([
			{
				...entry,
				quantity: '12.0000000000',
				net_amount: '24.00',
				tax_amount: '3.12',
				gross_amount: '27.12'
			},
			{
				...entry,
				__key: '00000000000000099999',
				detail_id: '99999',
				entry_id: '2',
				quantity: '1.0000000000',
				unit_price: '3.0000000000',
				unit_price_inclusive: '3.3900000000',
				net_amount: '3.00',
				tax_amount: '0.39',
				gross_amount: '3.39'
			}
		]);
		yield* pull;
		const changed = (yield* read()).order_lines.rows;
		expect(changed).toHaveLength(2);
		const kept = changed.find((row) => row.id === sale.line);
		const added = changed.find((row) => row.id !== sale.line);
		expect(sameDecimal(kept?.quantity, '12')).toBe(true);
		expect(sameDecimal(kept?.total, '27.12')).toBe(true);
		expect(added).toMatchObject({ product: sale.product, source_entry_id: '2' });
		expect(sameDecimal(added?.unit_price, '3')).toBe(true);
		setEntries(entries().filter((row) => row.entry_id === '2'));
		yield* pull;
		expect((yield* read()).order_lines.rows.map((row) => row.source_entry_id)).toEqual(['2']);
	})
);

it.live('a local line change amends the SO, and the next read keeps it', () =>
	Effect.gen(function* () {
		const { t, as, sale, fixture, fid, pull, read, entries } = yield* syncedSale();
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', sale.line), set: { quantity: '15' } }
				]
			})
		);
		// a read before the write lands leaves the unsent change in place
		yield* pull;
		expect(sameDecimal((yield* read()).order_lines.rows[0]?.quantity, '15')).toBe(true);
		yield* t.deliver();
		expect(fixture.tables.SEOrder?.find((row) => row.fid === fid)?.version).toBe('001');
		expect(fixture.tables.ICOrderAlter).toHaveLength(1);
		expect(entries().map((row) => row.entry_id)).toEqual(['1']);
		expect(sameDecimal(String(entries()[0]?.quantity), '15')).toBe(true);
		yield* pull;
		const { orders, order_lines } = yield* read();
		expect(orders.rows[0]?.kingdee).toMatchObject({ fid, version: '001' });
		expect(order_lines.rows).toMatchObject([{ id: sale.line, source_entry_id: '1' }]);
		expect(sameDecimal(order_lines.rows[0]?.quantity, '15')).toBe(true);
	})
);
