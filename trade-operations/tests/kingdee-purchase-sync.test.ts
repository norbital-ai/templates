import { randomUUID } from 'node:crypto';
import type { Id } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { committed, workspace, PROBE_NET60 } from './kit.js';
import { kingdeeCatalogue, kingdeeFixture, kingdeePurchase } from './kingdee-fixture.js';
import { sameDecimal } from './test-runtime.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

/** A confirmed PO and its Kingdee PO, with the reads that mirror it back. */
const syncedPurchase = Effect.fnUntraced(function* (
	fixture: ReturnType<typeof kingdeeFixture> = kingdeeFixture()
) {
	const t = yield* workspace({ source: fixture.request });
	const as = yield* t.as(t.admin);
	const purchase = yield* kingdeePurchase(t, fixture);
	yield* t.deliver();
	const pull = Effect.gen(function* () {
		yield* t.pull('orders');
		yield* t.pull('order_lines');
	});
	yield* pull;
	const read = () =>
		as.query({
			orders: { where: { id: { eq: purchase.order } }, limit: 1 },
			order_lines: { where: { order: { eq: purchase.order } } }
		});
	const fid = () => String(fixture.tables.POOrder?.[0]?.fid);
	const entries = () => (fixture.tables.POOrderEntry ?? []).filter((row) => row.fid === fid());
	const setHeader = (change: SqlRow) => {
		fixture.tables.POOrder = (fixture.tables.POOrder ?? []).map((row) =>
			row.fid === fid() ? { ...row, ...change } : row
		);
	};
	const setQuantity = (line: Id<'order_lines'>, quantity: string) =>
		Effect.gen(function* () {
			committed(
				'order_lines',
				yield* as.act({
					'order_lines.update': [{ target: yield* t.at('order_lines', line), set: { quantity } }]
				})
			);
		});
	return { t, as, fixture, purchase, pull, read, fid, entries, setHeader, setQuantity };
});

it.live(
	'a confirmed PO writes one unaudited Kingdee PO and reads its identity and lines back',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedPurchase();
			expect(s.fixture.tables.POOrder).toHaveLength(1);
			expect(s.fixture.tables.SEOrder).toHaveLength(0);
			const [submitted] = [...s.fixture.submissions.values()];
			expect(submitted?.header).toMatchObject({ FTranType: '71', FSupplyID: '201' });
			const { orders, order_lines } = yield* s.read();
			expect(orders.rows[0]?.kingdee).toMatchObject({ fid: s.fid(), status: 'draft' });
			expect(order_lines.rows[0]).toMatchObject({ source_entry_id: '1' });
			expect(order_lines.rows[0]?.$sync?.kingdee?.status).toBe('ok');
			// a second pass sends nothing: what was read is what Kingdee holds
			expect((yield* s.t.deliver()).delivered).toBe(0);
		})
);

it.live('while Kingdee is down a confirmed PO waits as pending and lands once', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request });
		const as = yield* t.as(t.admin);
		const purchase = yield* kingdeePurchase(t, fixture);
		fixture.state.unreachable = 3;
		for (let attempt = 0; attempt < 3; attempt++) {
			yield* t.deliver();
			t.clock.advance('2min');
		}
		const status = () =>
			as
				.query({ orders: { where: { id: { eq: purchase.order } }, limit: 1 } })
				.pipe(Effect.map(({ orders }) => orders.rows[0]?.$sync?.kingdee?.status));
		expect(yield* status()).toBe('pending');
		expect(fixture.tables.POOrder).toHaveLength(0);
		yield* t.deliver();
		t.clock.advance('2min');
		yield* t.deliver();
		expect(fixture.tables.POOrder).toHaveLength(1);
		expect(yield* status()).toBe('ok');
	})
);

it.live(
	'a PO whose create reply was lost, read before the retry, exists once with its lines bound',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			fixture.state.loseNextReceipt = true;
			const s = yield* syncedPurchase(fixture);
			expect(fixture.state.lostReceipts).toBe(1);
			s.t.clock.advance('2min');
			yield* s.t.deliver();
			yield* s.pull;
			expect(fixture.tables.POOrder).toHaveLength(1);
			const { orders, order_lines } = yield* s.read();
			expect(orders.rows[0]?.$sync?.kingdee?.status).toBe('ok');
			expect(orders.rows[0]?.kingdee?.fid).toBe(s.fid());
			expect(order_lines.rows).toHaveLength(1);
			expect(order_lines.rows[0]?.source_entry_id).toBe('1');
		})
);

it.live(
	'an unaudited PO takes local line changes in place, and an added line lands once through a lost reply',
	() =>
		Effect.gen(function* () {
			const s = yield* syncedPurchase();
			yield* s.setQuantity(s.purchase.line, '12');
			yield* s.t.deliver();
			expect(s.fixture.tables.POOrder).toHaveLength(1);
			expect(s.entries().map((row) => sameDecimal(String(row.quantity), '12'))).toEqual([true]);
			const added = committed(
				'order_lines',
				yield* s.as.act({
					'order_lines.create': [
						{
							order: s.purchase.order,
							product: s.purchase.product,
							quantity: '4',
							unit_price: '2',
							discount_pct: '0',
							tax_rate: '13'
						}
					]
				})
			);
			s.fixture.state.loseNextReceipt = true;
			yield* s.t.deliver();
			expect(s.entries()).toHaveLength(2);
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

it.live('a Kingdee edit to an unaudited PO wins where nothing local is pending', () =>
	Effect.gen(function* () {
		const s = yield* syncedPurchase();
		s.fixture.tables.POOrderEntry = s.entries().map((row) => ({
			...row,
			quantity: '7',
			net_amount: '14',
			tax_amount: '1.82',
			gross_amount: '15.82'
		}));
		yield* s.pull;
		const { order_lines } = yield* s.read();
		expect(sameDecimal(order_lines.rows[0]?.quantity, '7')).toBe(true);
		expect(sameDecimal(order_lines.rows[0]?.total, '15.82')).toBe(true);
		// the mirrored change is not sent back
		expect((yield* s.t.deliver()).delivered).toBe(0);
	})
);

it.live('a Kingdee PO edit racing ours makes ours read again and land on top of it', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		let race = false;
		const t = yield* workspace({
			source: (op) => {
				if (
					race &&
					op.op === 'call' &&
					String(op.arguments.stmt).includes('DELETE FROM dbo.POOrderEntry')
				) {
					race = false;
					// another Kingdee user saves the PO between our read and our write
					fixture.tables.POOrderEntry = (fixture.tables.POOrderEntry ?? []).map((row) => ({
						...row,
						quantity: '9',
						net_amount: '18'
					}));
				}
				return fixture.request(op);
			}
		});
		const as = yield* t.as(t.admin);
		const purchase = yield* kingdeePurchase(t, fixture);
		yield* t.deliver();
		yield* t.pull('orders');
		yield* t.pull('order_lines');
		race = true;
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', purchase.line), set: { quantity: '12' } }
				]
			})
		);
		yield* t.deliver();
		expect(
			(yield* as.query({ order_lines: { where: { id: { eq: purchase.line } } } })).order_lines
				.rows[0]?.$sync?.kingdee?.status
		).toBe('pending');
		t.clock.advance('2min');
		yield* t.deliver();
		expect(
			fixture.tables.POOrderEntry?.map((row) => sameDecimal(String(row.quantity), '12'))
		).toEqual([true]);
	})
);

it.live('an audited PO refuses a local line change, which returns to the PO’s terms', () =>
	Effect.gen(function* () {
		const s = yield* syncedPurchase();
		s.setHeader({ checker: '42', checked_on: '2026-10-11' });
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.kingdee?.status).toBe('issued');
		yield* s.setQuantity(s.purchase.line, '15');
		yield* s.t.deliver();
		expect(s.entries().map((row) => sameDecimal(String(row.quantity), '10'))).toEqual([true]);
		expect((yield* s.read()).order_lines.rows[0]?.$sync?.kingdee?.status).toBe('failed');
		yield* s.pull;
		const { order_lines } = yield* s.read();
		expect(sameDecimal(order_lines.rows[0]?.quantity, '10')).toBe(true);
	})
);

it.live('a PO closed or voided in Kingdee shows on the order and refuses further changes', () =>
	Effect.gen(function* () {
		const s = yield* syncedPurchase();
		s.setHeader({ closed: 1 });
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.kingdee).toMatchObject({ closed: true });
		yield* s.setQuantity(s.purchase.line, '15');
		yield* s.t.deliver();
		expect(s.entries().map((row) => sameDecimal(String(row.quantity), '10'))).toEqual([true]);
		s.setHeader({ closed: 0, cancelled: true });
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.kingdee).toMatchObject({ status: 'void' });
	})
);

/** A PO a Kingdee user created, not submitted by any order here. */
const kingdeeCreatedPurchase = Effect.fnUntraced(function* (
	options: { readonly cancelled?: boolean } = {}
) {
	const fixture = kingdeeFixture(() => {
		const base = kingdeeCatalogue();
		const supplier = base['/parties']?.[1];
		if (supplier === null || typeof supplier !== 'object' || Array.isArray(supplier))
			throw new Error('Fixture supplier required');
		return {
			...base,
			'/parties': [
				...(base['/parties'] ?? []),
				{
					...supplier,
					external_code: '202',
					source_number: 'SUP-202',
					supplier_name: 'Second supplier'
				}
			]
		};
	});
	let interrupt = false;
	const t = yield* workspace({
		source: (op) => {
			if (
				interrupt &&
				op.op === 'call' &&
				String(op.arguments.stmt).includes('FROM dbo.POOrderEntry line')
			) {
				interrupt = false;
				return Effect.fail(
					new FacilityFailure({
						kind: 'upstream',
						message: 'Connection interrupted during source discovery'
					})
				);
			}
			return fixture.request(op);
		}
	});
	const as = yield* t.as(t.admin);
	// our own PO first: the ledger's purchase documents are verified and its owner bound to employee 701
	yield* kingdeePurchase(t, fixture);
	yield* t.deliver();
	const uuid = randomUUID(),
		fid = '16900';
	fixture.tables.POOrder?.push({
		__key: fid.padStart(20, '0'),
		fid,
		branch: '0',
		uuid,
		reference: 'PO-KINGDEE',
		currency: 'CNY',
		version: '000',
		cancelled: options.cancelled ?? false,
		archive: 0,
		checker: '0',
		checked_on: null,
		closed: 0,
		employee_id: '701',
		party_id: '201',
		party_name: 'Kingdee supplier',
		ordered_on: '2026-10-12',
		exchange_rate: '1',
		settlement: 'PROBE-NET30',
		rowversion: '0x0000000000000001'
	});
	for (const entry of ['1', '2'])
		fixture.tables.POOrderEntry?.push({
			__key: `1690${entry}`.padStart(20, '0'),
			fid,
			detail_id: `1690${entry}`,
			entry_id: entry,
			item_id: '301',
			unit: 'kg',
			quantity: '3',
			unit_price: '2',
			unit_price_inclusive: '2.26',
			tax_rate: '13',
			net_amount: '6',
			tax_amount: '0.78',
			gross_amount: '6.78'
		});
	fixture.submissions.set(uuid, { remote: fid, hash: 'native-created', header: {}, lines: [] });
	// the first read brings it in as a draft, the second confirms it, then its lines arrive
	const pull = Effect.gen(function* () {
		yield* t.pull('orders');
		yield* t.pull('orders');
		yield* t.pull('order_lines');
	});
	const read = () => as.query({ orders: { where: { title: { eq: 'PO-KINGDEE' } }, lines: {} } });
	const setHeader = (change: SqlRow) => {
		fixture.tables.POOrder = (fixture.tables.POOrder ?? []).map((row) =>
			row.fid === fid ? { ...row, ...change } : row
		);
	};
	return {
		t,
		as,
		fixture,
		fid,
		uuid,
		pull,
		read,
		setHeader,
		interrupt: () => {
			interrupt = true;
		}
	};
});

it.live(
	'a PO created in Kingdee arrives once, confirmed with its lines, and sends nothing back',
	() =>
		Effect.gen(function* () {
			const s = yield* kingdeeCreatedPurchase();
			yield* s.pull;
			const [order, ...others] = (yield* s.read()).orders.rows;
			expect(others).toHaveLength(0);
			expect(order).toMatchObject({
				direction: 'purchasing',
				status: 'confirmed',
				ordered_on: '2026-10-12',
				kingdee: { fid: s.fid, status: 'draft' }
			});
			expect(order?.lines.map((line) => line.source_entry_id).sort()).toEqual(['1', '2']);
			yield* s.pull;
			expect((yield* s.read()).orders.rows).toHaveLength(1);
			expect((yield* s.t.deliver()).delivered).toBe(0);
			expect(s.fixture.tables.POOrder).toHaveLength(2);
		})
);

it.live('Kingdee changes to a Kingdee-created PO’s lines and terms reach the order', () =>
	Effect.gen(function* () {
		const s = yield* kingdeeCreatedPurchase();
		yield* s.t.pull('parties');
		yield* s.pull;
		s.fixture.tables.POOrderEntry = (s.fixture.tables.POOrderEntry ?? []).map((row) =>
			row.fid === s.fid && row.entry_id === '2'
				? { ...row, quantity: '5', net_amount: '10', tax_amount: '1.3', gross_amount: '11.3' }
				: row
		);
		s.setHeader({ settlement: 'PROBE-NET60', ordered_on: '2026-10-13', party_id: '202' });
		yield* s.t.pull('orders');
		yield* s.t.pull('order_lines');
		const { orders, parties } = yield* s.as.query({
			orders: { where: { title: { eq: 'PO-KINGDEE' } }, lines: {} },
			parties: { where: { external_code: { eq: '202' } }, limit: 1 }
		});
		const order = orders.rows[0];
		expect(order).toMatchObject({
			payment_terms: PROBE_NET60,
			ordered_on: '2026-10-13',
			party: parties.rows[0]?.id,
			party_name: 'Second supplier'
		});
		const line = order?.lines.find((row) => row.source_entry_id === '2');
		expect(sameDecimal(line?.quantity, '5')).toBe(true);
		expect(sameDecimal(line?.total, '11.3')).toBe(true);
		expect((yield* s.t.deliver()).delivered).toBe(0);
	})
);

it.live('a local change to an unaudited Kingdee-created PO lands on that PO', () =>
	Effect.gen(function* () {
		const s = yield* kingdeeCreatedPurchase();
		yield* s.pull;
		const line = (yield* s.read()).orders.rows[0]?.lines.find((row) => row.source_entry_id === '1');
		if (!line) throw new Error('Imported line required');
		committed(
			'order_lines',
			yield* s.as.act({
				'order_lines.update': [
					{ target: yield* s.t.at('order_lines', line.id), set: { quantity: '6' } }
				]
			})
		);
		yield* s.t.deliver();
		const entries = (s.fixture.tables.POOrderEntry ?? []).filter((row) => row.fid === s.fid);
		expect(
			entries
				.map((row) => [row.entry_id, Number(row.quantity)])
				.sort(([a], [b]) => String(a).localeCompare(String(b)))
		).toEqual([
			['1', 6],
			['2', 3]
		]);
		expect(s.fixture.tables.POOrder?.filter((row) => row.uuid === s.uuid)).toHaveLength(1);
	})
);

it.live('a void Kingdee PO no order holds is not imported', () =>
	Effect.gen(function* () {
		const s = yield* kingdeeCreatedPurchase({ cancelled: true });
		yield* s.pull;
		expect((yield* s.read()).orders.rows).toHaveLength(0);
	})
);

it.live(
	'an import interrupted mid-read commits nothing, and the next read imports one complete PO',
	() =>
		Effect.gen(function* () {
			const s = yield* kingdeeCreatedPurchase();
			s.interrupt();
			expect((yield* Effect.exit(s.t.pull('orders')))._tag).toBe('Failure');
			expect((yield* s.read()).orders.rows).toHaveLength(0);
			yield* s.pull;
			yield* s.pull;
			const orders = (yield* s.read()).orders.rows;
			expect(orders.map((order) => order.lines.length)).toEqual([2]);
		})
);

it.live('a completed Kingdee PO no order holds is history and is not imported', () =>
	Effect.gen(function* () {
		const s = yield* kingdeeCreatedPurchase();
		s.setHeader({ closed: 1, checker: '42', checked_on: '2026-10-12' });
		yield* s.pull;
		expect((yield* s.read()).orders.rows).toHaveLength(0);
	})
);
