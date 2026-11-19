import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, workspace } from './kit.js';
import { kingdeeCatalogue, kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { fixtureId, sameDecimal } from './test-runtime.js';
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

const quantity = (rows: readonly { readonly quantity: string }[], index = 0) =>
	rows[index]?.quantity;
const setQuantity = Effect.fnUntraced(function* (
	t: Effect.Success<ReturnType<typeof syncedSale>>['t'],
	line: Effect.Success<ReturnType<typeof syncedSale>>['sale']['line'],
	value: string
) {
	const as = yield* t.as(t.admin);
	committed(
		'order_lines',
		yield* as.act({
			'order_lines.update': [{ target: yield* t.at('order_lines', line), set: { quantity: value } }]
		})
	);
});
const kingdeeQuantity = (s: Effect.Success<ReturnType<typeof syncedSale>>, value: string) =>
	s.setEntries(s.entries().map((row) => ({ ...row, quantity: `${value}.0000000000` })));
const liveOrders = (s: Effect.Success<ReturnType<typeof syncedSale>>) =>
	(s.fixture.tables.SEOrder ?? []).filter((row) => !row.archive);

it.live(
	'a concurrent Kingdee and local edit of one line resolves to the local edit, read first or write first',
	() =>
		Effect.gen(function* () {
			for (const readFirst of [true, false]) {
				const s = yield* syncedSale();
				kingdeeQuantity(s, '12');
				yield* setQuantity(s.t, s.sale.line, '15');
				if (readFirst) {
					yield* s.pull;
					const held = (yield* s.read()).order_lines.rows[0];
					expect(sameDecimal(held?.quantity, '15')).toBe(true);
					expect(held?.$sync?.kingdee?.status).toBe('pending');
				}
				yield* s.t.deliver();
				yield* s.pull;
				expect(sameDecimal(String(s.entries()[0]?.quantity), '15')).toBe(true);
				const { order_lines } = yield* s.read();
				expect(sameDecimal(quantity(order_lines.rows), '15')).toBe(true);
				expect(order_lines.rows[0]?.$sync?.kingdee?.status).toBe('ok');
				// the overwritten Kingdee value stays in Kingdee's own change log
				expect(s.fixture.tables.ICOrderAlter).toHaveLength(1);
			}
		})
);

it.live('a Kingdee edit to a line with no local change wins locally', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		kingdeeQuantity(s, '12');
		yield* s.pull;
		expect(sameDecimal(quantity((yield* s.read()).order_lines.rows), '12')).toBe(true);
		expect((yield* s.t.deliver()).delivered).toBe(0);
		expect(s.fixture.tables.ICOrderAlter).toHaveLength(0);
	})
);

it.live(
	'our own write read back is no remote change: nothing bounces and Kingdee state lands',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedSale();
			yield* setQuantity(s.t, s.sale.line, '15');
			yield* s.t.deliver();
			const before = (yield* s.read()).order_lines.rows[0];
			yield* s.pull;
			yield* s.pull;
			expect((yield* s.t.deliver()).delivered).toBe(0);
			expect(s.fixture.tables.ICOrderAlter).toHaveLength(1);
			const { orders, order_lines } = yield* s.read();
			expect(orders.rows[0]?.kingdee?.version).toBe('001');
			expect(order_lines.rows[0]?.revision).toBe(before?.revision);
		})
);

it.live('an unaudited SO created by confirm reads its Kingdee identity back', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request });
		const as = yield* t.as(t.admin);
		const sale = yield* kingdeeSale(t, fixture);
		yield* t.deliver();
		yield* t.pull('orders');
		const order = (yield* as.query({ orders: { where: { id: { eq: sale.order } }, limit: 1 } }))
			.orders.rows[0];
		expect(order?.kingdee).toMatchObject({ status: 'draft', version: '000' });
	})
);

it.live(
	'a multi-line amendment that aborts in Kingdee leaves both sides whole and converges on retry',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedSale();
			const added = committed(
				'order_lines',
				yield* s.as.act({
					'order_lines.create': [
						{
							order: s.sale.order,
							product: s.sale.product,
							quantity: '4',
							unit_price: '2',
							discount_pct: '0',
							tax_rate: '13'
						}
					]
				})
			);
			yield* setQuantity(s.t, s.sale.line, '15');
			// each line's write sends the whole order: both attempts of this pass abort
			s.fixture.state.abortAmendments = 2;
			yield* s.t.deliver();
			// the amendment is one Kingdee transaction: nothing of it landed
			expect(s.entries()).toHaveLength(1);
			expect(sameDecimal(String(s.entries()[0]?.quantity), '10')).toBe(true);
			const held = (yield* s.read()).order_lines.rows;
			expect(held.map((row) => row.$sync?.kingdee?.status)).toEqual(['pending', 'pending']);
			yield* s.pull;
			expect((yield* s.read()).order_lines.rows).toHaveLength(2);
			s.t.clock.advance('2min');
			yield* s.t.deliver();
			yield* s.pull;
			expect(
				s
					.entries()
					.map((row) => row.entry_id)
					.sort()
			).toEqual(['1', '2']);
			expect(s.fixture.tables.ICOrderAlter?.map((row) => row.version)).toEqual(['001']);
			const { order_lines } = yield* s.read();
			expect(order_lines.rows.find((row) => row.id === added)?.source_entry_id).toBe('2');
			expect(order_lines.rows.map((row) => row.$sync?.kingdee?.status)).toEqual(['ok', 'ok']);
		})
);

it.live('a Kingdee amendment racing ours makes ours read again and land on the new version', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		yield* setQuantity(s.t, s.sale.line, '15');
		// Kingdee's own 订单变更 lands between the writer's read and its amendment
		s.fixture.state.beforeAmendment = () => {
			s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) =>
				row.fid === s.fid ? { ...row, version: '001' } : row
			);
		};
		yield* s.t.deliver();
		expect((yield* s.read()).order_lines.rows[0]?.$sync?.kingdee?.status).toBe('pending');
		s.t.clock.advance('2min');
		yield* s.t.deliver();
		expect(liveOrders(s).find((row) => row.fid === s.fid)?.version).toBe('002');
		expect(sameDecimal(String(s.entries()[0]?.quantity), '15')).toBe(true);
	})
);

it.live('an amendment whose receipt was lost is not applied twice', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		yield* setQuantity(s.t, s.sale.line, '15');
		s.fixture.state.loseNextReceipt = true;
		yield* s.t.deliver();
		expect(s.fixture.state.lostReceipts).toBe(1);
		s.t.clock.advance('2min');
		yield* s.t.deliver();
		expect(s.fixture.tables.ICOrderAlter).toHaveLength(1);
		expect(liveOrders(s).find((row) => row.fid === s.fid)?.version).toBe('001');
	})
);

it.live(
	'while Kingdee is down writes wait as pending on the order and recover without duplicates',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = yield* t.as(t.admin);
			const sale = yield* kingdeeSale(t, fixture);
			fixture.state.unreachable = 3;
			for (let attempt = 0; attempt < 3; attempt++) {
				yield* t.deliver();
				t.clock.advance('2min');
			}
			const order = (yield* as.query({ orders: { where: { id: { eq: sale.order } }, limit: 1 } }))
				.orders.rows[0];
			expect(order?.$sync?.kingdee).toMatchObject({ status: 'pending' });
			expect(fixture.tables.SEOrder).toHaveLength(0);
			yield* t.deliver();
			expect(fixture.tables.SEOrder).toHaveLength(1);
			t.clock.advance('2min');
			yield* t.deliver();
			expect(fixture.tables.SEOrder).toHaveLength(1);
			const done = (yield* as.query({ orders: { where: { id: { eq: sale.order } }, limit: 1 } }))
				.orders.rows[0];
			expect(done?.$sync?.kingdee?.status).toBe('ok');
		})
);

it.live('a line deleted locally leaves the SO; a voided or closed SO shows on the order', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		const added = committed(
			'order_lines',
			yield* s.as.act({
				'order_lines.create': [
					{
						order: s.sale.order,
						product: s.sale.product,
						quantity: '4',
						unit_price: '2',
						discount_pct: '0',
						tax_rate: '13'
					}
				]
			})
		);
		yield* s.t.deliver();
		yield* s.pull;
		expect(s.entries()).toHaveLength(2);
		committed(
			'order_lines',
			yield* s.as.act({ 'order_lines.delete': [{ target: yield* s.t.at('order_lines', added) }] })
		);
		yield* s.t.deliver();
		expect(s.entries().map((row) => row.entry_id)).toEqual(['1']);
		yield* s.pull;
		expect((yield* s.read()).order_lines.rows.map((row) => row.id)).toEqual([s.sale.line]);
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) =>
			row.fid === s.fid ? { ...row, closed: 1 } : row
		);
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.kingdee).toMatchObject({ closed: true });
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) =>
			row.fid === s.fid ? { ...row, cancelled: true } : row
		);
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.kingdee).toMatchObject({ status: 'void' });
	})
);

it.live('a full read takes Kingdee header changes and keeps unsent local line edits', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) =>
			row.fid === s.fid ? { ...row, ordered_on: '2026-10-11', settlement: 'PROBE-NET60' } : row
		);
		yield* setQuantity(s.t, s.sale.line, '15');
		// the amendment waits for the read to bring Kingdee's header in
		yield* s.t.deliver();
		expect((yield* s.read()).order_lines.rows[0]?.$sync?.kingdee?.status).toBe('pending');
		yield* s.pull;
		const { orders, order_lines } = yield* s.read();
		expect(orders.rows[0]).toMatchObject({
			ordered_on: '2026-10-11',
			payment_terms: 'PROBE-NET60'
		});
		expect(sameDecimal(quantity(order_lines.rows), '15')).toBe(true);
		s.t.clock.advance('2min');
		yield* s.t.deliver();
		yield* s.pull;
		expect(sameDecimal(String(s.entries()[0]?.quantity), '15')).toBe(true);
		expect((yield* s.read()).order_lines.rows[0]?.$sync?.kingdee?.status).toBe('ok');
	})
);

it.live('a header change on a Kingdee-bound confirmed order is refused with its reason', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		const refused = yield* Effect.flip(
			s.as.act({
				'orders.update': [
					{ target: yield* s.t.at('orders', s.sale.order), set: { payment_terms: 'PROBE-NET60' } }
				]
			})
		);
		expect(refused.message).toContain('Kingdee keeps');
		expect((yield* s.read()).orders.rows[0]?.payment_terms).toBe('PROBE-NET30');
		expect((yield* s.t.deliver()).delivered).toBe(0);
	})
);

const twoProductCatalogue = () => {
	const base = kingdeeCatalogue();
	return {
		...base,
		'/products': [
			...(base['/products'] ?? []),
			{
				external_code: '302',
				source_number: 'ITEM-302',
				name: 'Kingdee resin B',
				spec: 'B',
				unit: 'kg',
				deleted: 0,
				unused: 0,
				detail_deleted: 0
			}
		]
	};
};

it.live('every Kingdee-updated header and line field appears in Trade Operations', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture(twoProductCatalogue);
		const t = yield* workspace({ source: fixture.request });
		const as = yield* t.as(t.admin);
		const sale = yield* kingdeeSale(t, fixture);
		yield* t.deliver();
		yield* t.pull('products');
		yield* t.pull('orders');
		yield* t.pull('order_lines');
		const fid = [...fixture.submissions.values()].at(-1)?.remote;
		if (!fid) throw new Error('The writer must create the SO');

		fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
			row.fid === fid
				? {
						...row,
						reference: 'SIM-SO-RENAMED',
						currency: 'USD',
						exchange_rate: '7.2000000000',
						settlement: 'PROBE-NET60',
						ordered_on: '2026-11-05',
						version: '003',
						checker: '701',
						checked_on: '2026-11-05',
						closed: 1
					}
				: row
		);
		const entry = (fixture.tables.SEOrderEntry ?? []).find((row) => row.fid === fid);
		if (!entry) throw new Error('SO entry required');
		fixture.tables.SEOrderEntry = [
			...(fixture.tables.SEOrderEntry ?? []).filter((row) => row.fid !== fid),
			{
				...entry,
				item_id: '302',
				unit: 'kg',
				quantity: '8.0000000000',
				unit_price: '12.5000000000',
				unit_price_inclusive: '13.2500000000',
				tax_rate: '6.0000000000',
				net_amount: '100.00',
				tax_amount: '6.00',
				gross_amount: '106.00'
			}
		];

		yield* t.pull('orders');
		yield* t.pull('order_lines');

		const { orders, order_lines, products } = yield* as.query({
			orders: { where: { id: { eq: sale.order } }, limit: 1 },
			order_lines: { where: { order: { eq: sale.order } } },
			products: { where: { external_code: { eq: '302' } }, limit: 1 }
		});
		const secondProduct = products.rows[0]?.id;
		expect(secondProduct).toBeTruthy();
		expect(orders.rows[0]).toMatchObject({
			currency: 'USD',
			payment_terms: 'PROBE-NET60',
			ordered_on: '2026-11-05',
			kingdee: {
				fid,
				reference: 'SIM-SO-RENAMED',
				version: '003',
				status: 'issued',
				closed: true,
				exchange_rate: '7.2000000000'
			}
		});
		const line = order_lines.rows[0];
		expect(line).toMatchObject({
			product: secondProduct,
			product_code: '302',
			product_name: 'Kingdee resin B',
			product_spec: 'B',
			unit: 'kg',
			currency: 'USD'
		});
		expect(sameDecimal(line?.quantity, '8')).toBe(true);
		expect(sameDecimal(line?.unit_price, '12.5')).toBe(true);
		expect(sameDecimal(line?.discount_pct, '0')).toBe(true);
		expect(sameDecimal(line?.tax_rate, '6')).toBe(true);
		expect(sameDecimal(line?.net, '100')).toBe(true);
		expect(sameDecimal(line?.tax, '6')).toBe(true);
		expect(sameDecimal(line?.total, '106')).toBe(true);
	})
);

it.live(
	'every two-way line edit (price, discount, tax, add, delete) amends Kingdee and reads back',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture(twoProductCatalogue);
			const t = yield* workspace({ source: fixture.request });
			const as = yield* t.as(t.admin);
			const sale = yield* kingdeeSale(t, fixture);
			yield* t.deliver();
			const fid = [...fixture.submissions.values()].at(-1)?.remote;
			if (!fid) throw new Error('The writer must create the SO');
			fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
				row.fid === fid ? { ...row, checker: '701', checked_on: '2026-10-10' } : row
			);
			yield* t.pull('products');
			yield* t.pull('orders');
			yield* t.pull('order_lines');

			// 1. Update quantity, unit_price, discount_pct and tax_rate on existing line (effective price = 9)
			committed(
				'order_lines',
				yield* as.act({
					'order_lines.update': [
						{
							target: yield* t.at('order_lines', sale.line),
							set: { quantity: '5', unit_price: '10', discount_pct: '10', tax_rate: '6' }
						}
					]
				})
			);
			yield* t.deliver();
			let entries = (fixture.tables.SEOrderEntry ?? []).filter((row) => row.fid === fid);
			expect(entries).toHaveLength(1);
			expect(sameDecimal(String(entries[0]?.quantity), '5')).toBe(true);
			expect(sameDecimal(String(entries[0]?.unit_price), '9')).toBe(true);
			expect(sameDecimal(String(entries[0]?.tax_rate), '6')).toBe(true);
			expect(sameDecimal(String(entries[0]?.net_amount), '45')).toBe(true);
			expect(sameDecimal(String(entries[0]?.tax_amount), '2.7')).toBe(true);
			expect(sameDecimal(String(entries[0]?.gross_amount), '47.7')).toBe(true);
			expect(fixture.tables.SEOrder?.find((row) => row.fid === fid)?.version).toBe('001');
			expect(fixture.tables.ICOrderAlter).toHaveLength(1);

			// 2. Replace product line atomically: add product 302 and remove old line 1
			const secondProduct = (yield* as.query({
				products: { where: { external_code: { eq: '302' } }, limit: 1 }
			})).products.rows[0]?.id;
			if (!secondProduct) throw new Error('Second product required');
			const added = committed(
				'order_lines',
				yield* as.act({
					'order_lines.create': [
						{
							order: sale.order,
							product: secondProduct,
							quantity: '4',
							unit_price: '20',
							discount_pct: '0',
							tax_rate: '13'
						}
					],
					'order_lines.delete': [{ target: yield* t.at('order_lines', sale.line) }]
				})
			);
			yield* t.deliver();
			entries = (fixture.tables.SEOrderEntry ?? []).filter((row) => row.fid === fid);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({ entry_id: '2', item_id: '302' });
			expect(sameDecimal(String(entries[0]?.quantity), '4')).toBe(true);
			expect(sameDecimal(String(entries[0]?.unit_price), '20')).toBe(true);
			expect(fixture.tables.SEOrder?.find((row) => row.fid === fid)?.version).toBe('002');
			expect(fixture.tables.ICOrderAlter).toHaveLength(2);

			yield* t.pull('orders');
			yield* t.pull('order_lines');
			const after = yield* as.query({
				orders: { where: { id: { eq: sale.order } }, limit: 1 },
				order_lines: { where: { order: { eq: sale.order } } }
			});
			expect(after.orders.rows[0]?.kingdee).toMatchObject({ version: '002' });
			expect(after.order_lines.rows).toMatchObject([
				{ id: added, source_entry_id: '2', product: secondProduct }
			]);
			expect(after.order_lines.rows[0]?.$sync?.kingdee?.status).toBe('ok');
		})
);

it.live(
	'a line change Kingdee refuses for good returns to the SO terms, and a refused new line leaves',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedSale();
			s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) =>
				row.fid === s.fid ? { ...row, closed: 1 } : row
			);
			yield* setQuantity(s.t, s.sale.line, '15');
			committed(
				'order_lines',
				yield* s.as.act({
					'order_lines.create': [
						{
							order: s.sale.order,
							product: s.sale.product,
							quantity: '4',
							unit_price: '2',
							discount_pct: '0',
							tax_rate: '13'
						}
					]
				})
			);
			yield* s.t.deliver();
			const status = Effect.map(
				s.read(),
				({ order_lines }) =>
					order_lines.rows.find((row) => row.id === s.sale.line)?.$sync?.kingdee?.status
			);
			expect(yield* status).toBe('failed');
			yield* s.pull;
			const { order_lines } = yield* s.read();
			expect(order_lines.rows.map((row) => row.id)).toEqual([s.sale.line]);
			expect(sameDecimal(quantity(order_lines.rows), '10')).toBe(true);
			yield* s.t.deliver();
			yield* s.pull;
			expect(yield* status).toBe('ok');
			expect(sameDecimal(quantity((yield* s.read()).order_lines.rows), '10')).toBe(true);
			expect(sameDecimal(String(s.entries()[0]?.quantity), '10')).toBe(true);
			expect(s.fixture.tables.ICOrderAlter).toHaveLength(0);
		})
);

it.live('an SO deleted in Kingdee is never recreated by a later change', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		s.fixture.tables.SEOrder = [];
		s.setEntries([]);
		yield* s.pull;
		// Kingdee's deletes are soft; a row removed outright leaves the order as last read
		expect((yield* s.read()).orders.rows[0]).toMatchObject({
			status: 'confirmed',
			kingdee: { fid: s.fid }
		});
		yield* setQuantity(s.t, s.sale.line, '15');
		yield* s.t.deliver();
		expect(s.fixture.tables.SEOrder).toHaveLength(0);
		expect((yield* s.read()).order_lines.rows[0]?.$sync?.kingdee?.status).toBe('failed');
	})
);

it.live('a customer changed on the Kingdee SO moves the order to that customer', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture(() => {
			const base = kingdeeCatalogue();
			const customer = base['/parties']?.[0];
			if (customer === null || typeof customer !== 'object' || Array.isArray(customer))
				throw new Error('Fixture customer required');
			return {
				...base,
				'/parties': [
					...(base['/parties'] ?? []),
					{
						...customer,
						external_code: '102',
						source_number: 'CUST-102',
						customer_name: 'Second customer'
					}
				]
			};
		});
		const t = yield* workspace({ source: fixture.request });
		const as = yield* t.as(t.admin);
		const sale = yield* kingdeeSale(t, fixture);
		yield* t.deliver();
		yield* t.pull('parties');
		yield* t.pull('orders');
		fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) => ({
			...row,
			party_id: '102'
		}));
		yield* t.pull('orders');
		const { orders, parties } = yield* as.query({
			orders: { where: { id: { eq: sale.order } }, limit: 1 },
			parties: { where: { external_code: { eq: '102' } }, limit: 1 }
		});
		expect(parties.rows[0]?.id).toBeTruthy();
		expect(orders.rows[0]).toMatchObject({
			party: parties.rows[0]?.id,
			party_name: 'Second customer'
		});
	})
);

it.live('a salesperson changed on the Kingdee SO moves the order to the bound owner', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		const instance = fixtureId('sys_integration', 'kingdee');
		const second = fixtureId('sys_user', s.t.member(['sales']).id);
		const { sys_integration } = yield* s.as.query({
			sys_integration: { where: { id: { eq: instance } }, limit: 1 }
		});
		const configuration = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
			sys_integration.rows[0]?.configuration
		);
		const bindings = Schema.decodeUnknownSync(
			Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
		)(configuration['salespersonBindings']);
		yield* s.as.act({
			'sys_integration.update': [
				{
					target: { id: instance },
					set: {
						configuration: {
							...configuration,
							salespersonBindings: JSON.stringify({
								...bindings,
								[second]: { employeeId: '702', departmentId: '601' }
							})
						}
					}
				}
			]
		});
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) => ({
			...row,
			employee_id: '702'
		}));
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.owner).toBe(second);
		// an employee no one is bound to leaves the owner where it is
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) => ({
			...row,
			employee_id: '999'
		}));
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.owner).toBe(second);
	})
);

it.live('an idle read asks Kingdee only for its rowversion ceiling and an empty window', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		yield* s.pull;
		const before = s.fixture.calls.length;
		yield* s.pull;
		const idle = s.fixture.calls
			.slice(before)
			.map((call) => (call.op === 'call' ? String(call.arguments.stmt) : ''));
		// two feeds (orders, lines), each one ceiling and one window: no SO header, family or entry is read again
		expect(idle).toHaveLength(4);
		expect(idle.filter((stmt) => stmt.includes('MIN_ACTIVE_ROWVERSION'))).toHaveLength(2);
		expect(idle.filter((stmt) => stmt.includes('kingdee-order-window'))).toHaveLength(2);
		// a Kingdee edit moves its header: only then is the SO read
		kingdeeQuantity(s, '12');
		yield* s.pull;
		expect(sameDecimal(quantity((yield* s.read()).order_lines.rows), '12')).toBe(true);
	})
);

it.live(
	'a line added locally whose amendment reply was lost is not duplicated by a read in between',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedSale();
			const added = committed(
				'order_lines',
				yield* s.as.act({
					'order_lines.create': [
						{
							order: s.sale.order,
							product: s.sale.product,
							quantity: '4',
							unit_price: '2',
							discount_pct: '0',
							tax_rate: '13'
						}
					]
				})
			);
			// Kingdee commits the new entry, but its reply never arrives
			s.fixture.state.loseNextReceipt = true;
			yield* s.t.deliver();
			expect(s.entries()).toHaveLength(2);
			// the minute read runs before the write is retried
			yield* s.pull;
			s.t.clock.advance('2min');
			yield* s.t.deliver();
			yield* s.pull;
			expect(s.entries()).toHaveLength(2);
			const { order_lines } = yield* s.read();
			expect(order_lines.rows).toHaveLength(2);
			expect(order_lines.rows.find((row) => row.id === added)?.source_entry_id).toBe('2');
			expect(order_lines.rows.map((row) => row.$sync?.kingdee?.status)).toEqual(['ok', 'ok']);
		})
);

it.live('an unaudited SO takes a local line change in place, with no version or change log', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request });
		const as = yield* t.as(t.admin);
		const sale = yield* kingdeeSale(t, fixture);
		yield* t.deliver();
		yield* t.pull('orders');
		yield* t.pull('order_lines');
		yield* setQuantity(t, sale.line, '15');
		yield* t.deliver();
		const so = (fixture.tables.SEOrder ?? []).filter((row) => !row.archive);
		expect(so).toHaveLength(1);
		expect(so[0]).toMatchObject({ version: '000', checker: '0' });
		expect(fixture.tables.SEOrder).toHaveLength(1);
		expect(fixture.tables.ICOrderAlter).toHaveLength(0);
		const entries = (fixture.tables.SEOrderEntry ?? []).filter((row) => row.fid === so[0]?.fid);
		expect(entries.map((row) => [row.entry_id, Number(row.quantity)])).toEqual([['1', 15]]);
		const line = (yield* as.query({ order_lines: { where: { id: { eq: sale.line } } } }))
			.order_lines.rows[0];
		expect(line?.$sync?.kingdee?.status).toBe('ok');
	})
);

it.live('a moved header with no FUUID neither fails the read nor arrives as an order', () =>
	Effect.gen(function* () {
		const s = yield* syncedSale();
		const own = s.fixture.tables.SEOrder?.find((row) => row.fid === s.fid);
		if (!own) throw new Error('Owned SO required');
		s.fixture.tables.SEOrder?.push({
			...own,
			__key: '77000'.padStart(20, '0'),
			fid: '77000',
			uuid: null,
			reference: 'KIS-NO-UUID'
		});
		yield* s.pull;
		const { orders } = yield* s.as.query({ orders: { where: { title: { eq: 'KIS-NO-UUID' } } } });
		expect(orders.rows).toHaveLength(0);
		kingdeeQuantity(s, '12');
		yield* s.pull;
		expect(sameDecimal(quantity((yield* s.read()).order_lines.rows), '12')).toBe(true);
	})
);

it.live(
	'a live row Kingdee made behind an archived original is not imported as another order',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedSale();
			const own = s.fixture.tables.SEOrder?.find((row) => row.fid === s.fid);
			if (!own) throw new Error('Owned SO required');
			yield* s.pull;
			// Kingdee archived our original and made a later row, with its own FUUID, the live order
			s.fixture.tables.SEOrder = [
				{ ...own, archive: 1, cancelled: true },
				{
					...own,
					__key: '78000'.padStart(20, '0'),
					fid: '78000',
					uuid: crypto.randomUUID(),
					version: '001'
				}
			];
			yield* s.pull;
			yield* s.pull;
			const { orders } = yield* s.as.query({ orders: {} });
			expect(orders.rows.filter((row) => row.title === own.reference)).toHaveLength(0);
		})
);
