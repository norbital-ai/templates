import { fixtureId, decimalText, firstRow } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { expect, it as test } from '@effect/vitest';
import { DatabaseRequest, type DatabaseResult, type Json } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import type { Id, Page } from '@norbital-ai/bolt';
import { committed, confirm, draft, PRODUCT, workspace, type T } from './kit.js';
import { sourceFixture } from './source-fixture.js';
const now = '2026-10-10T00:00:00Z';
type Records = Record<string, Json[]>;
type Source = ReturnType<typeof sourceFixture>;
const ledgers = Effect.fnUntraced(function* (
	answer?: (instance: string, op: DatabaseRequest) => void
) {
	const records: {
		first: Records;
		second: Records;
	} = { first: {}, second: {} };
	const t = yield* workspace();
	const second = committed(
		'sys_integration',
		yield* t
			.as(t.admin)
			.act('sys_integration.create', { integration: 'kingdee', name: 'Second ledger' })
	);
	const sources: Record<string, Source> = {
		kingdee: sourceFixture(() => records.first),
		[second]: sourceFixture(() => records.second)
	};
	t.fakes.links.answer = (instance, op) =>
		Schema.decodeUnknownEffect(DatabaseRequest)(op).pipe(
			Effect.mapError((cause) => new FacilityFailure({ kind: 'invalid', message: String(cause) })),
			Effect.flatMap((request) =>
				Effect.gen(function* () {
					answer?.(instance, request);
					if (request.statement.includes('sp_getapplock'))
						return {
							rows: [
								{
									remote: `${instance}:${request.parameters.key}`,
									hash: request.parameters.hash ?? ''
								}
							]
						};
					const source = sources[instance];
					if (source === undefined)
						return yield* Effect.fail(
							new FacilityFailure({
								kind: 'invalid',
								message: `Unknown fixture ledger ${instance}`
							})
						);
					return yield* source(request);
				})
			)
		);
	const pull = Effect.fnUntraced(function* (collection: string) {
		yield* t.pull(collection, randomUUID(), 'kingdee');
		yield* t.pull(collection, randomUUID(), second);
	});
	return { t, second, records, pull };
});
const catalogue = (name: string) => ({
	'/parties': [
		{
			external_code: 'SAME-C',
			name,
			kind: 'customer',
			currency: 'SGD',
			active: true,
			source_updated_at: now
		}
	],
	'/products': [
		{
			external_code: 'SAME-P',
			name,
			unit: 'kg',
			currency: 'SGD',
			unit_price: '2',
			tax_rate: '9',
			active: true,
			source_updated_at: now
		}
	],
	'/warehouses': [
		{ external_code: 'WEST', name, group_code: 'WEST', active: true, source_updated_at: now }
	]
});
const one = Effect.fnUntraced(function* <A, E>(read: Effect.Effect<Page<A>, E>) {
	const { rows } = yield* read;
	expect(rows).toHaveLength(1);
	return firstRow(rows);
});
const ledgerOrder = Effect.fnUntraced(function* (t: T, ledger: Id<'sys_integration'>) {
	const as = t.as(t.admin);
	const party = yield* one(
		t.as(t.admin).read('parties', {
			where: { source: { eq: ledger }, external_code: { eq: 'SAME-C' } },
			all: true
		})
	);
	const product = yield* one(
		t.as(t.admin).read('products', {
			where: { source: { eq: ledger }, external_code: { eq: 'SAME-P' } },
			all: true
		})
	);
	const order = committed(
		'orders',
		yield* as.act('orders.create', {
			title: 'Ledger order',
			direction: 'sales',
			party: party.id,
			currency: 'SGD',
			payment_terms: 'Net 30'
		})
	);
	const line = committed(
		'order_lines',
		yield* as.act('order_lines.create', {
			order,
			product: product.id,
			quantity: Decimal.of('10'),
			unit_price: Decimal.of('2'),
			discount_pct: Decimal.of('0'),
			tax_rate: Decimal.of('9')
		})
	);
	yield* confirm(t, order);
	const sealed = yield* as.get('orders', order);
	return { order, line, seal: String(sealed?.seal_hash) };
});
test.live('stock and credit resolve their references inside their own ledger', () =>
	Effect.gen(function* () {
		const { t, second, records, pull } = yield* ledgers();
		for (const [ledger, name, onHand, limit] of [
			['first', 'First', '100', '1000'],
			['second', 'Second', '7', '5']
		] as const)
			records[ledger] = {
				...catalogue(name),
				'/stock_snapshots': [
					{
						external_code: 'SAME-P:WEST',
						product_code: 'SAME-P',
						warehouse_code: 'WEST',
						unit: 'kg',
						on_hand: onHand,
						as_of: now
					}
				],
				'/credit_snapshots': [
					{
						external_code: 'SAME-C:SGD',
						party_code: 'SAME-C',
						currency: 'SGD',
						credit_limit: limit,
						credit_used: '0',
						as_of: now
					}
				]
			};
		for (const collection of [
			'parties',
			'products',
			'warehouses',
			'stock_snapshots',
			'credit_snapshots'
		])
			yield* pull(collection);
		for (const [ledger, onHand, limit] of [
			[fixtureId('sys_integration', 'kingdee'), '100', '1000'],
			[second, '7', '5']
		] as const) {
			const stock = yield* one(
				t.as(t.admin).read('stock_snapshots', {
					where: { source: { eq: ledger }, external_code: { eq: 'SAME-P:WEST' } },
					all: true
				})
			);
			expect(stock).toMatchObject({ on_hand: decimalText(onHand) });
			expect(yield* t.as(t.admin).get('products', stock.product)).toMatchObject({
				source: ledger
			});
			expect(yield* t.as(t.admin).get('warehouses', stock.warehouse)).toMatchObject({
				source: ledger
			});
			const credit = yield* one(
				t.as(t.admin).read('credit_snapshots', {
					where: { source: { eq: ledger }, external_code: { eq: 'SAME-C:SGD' } },
					all: true
				})
			);
			expect(credit).toMatchObject({ credit_limit: decimalText(limit) });
			expect(yield* t.as(t.admin).get('parties', credit.party)).toMatchObject({
				source: ledger
			});
		}
	})
);
test.live(
	'transactions and payments sharing remote ids stay with their own ledger and orders',
	() =>
		Effect.gen(function* () {
			const { t, second, records, pull } = yield* ledgers();
			records.first = catalogue('First');
			records.second = catalogue('Second');
			for (const collection of ['parties', 'products', 'warehouses']) yield* pull(collection);
			const orders = {
				first: yield* ledgerOrder(t, fixtureId('sys_integration', 'kingdee')),
				second: yield* ledgerOrder(t, second)
			};
			for (const ledger of ['first', 'second'] as const) {
				const { order, line, seal } = orders[ledger];
				records[ledger] = {
					'/ext_sales_orders': [
						{
							external_id: 'SO-SAME',
							order_id: order,
							reference: 'SO-SAME',
							agreement_hash: seal,
							currency: 'SGD',
							status: 'issued',
							source_updated_at: now
						}
					],
					'/transactions': [
						{
							external_id: 'INV-SAME',
							parent_id: 'SO-SAME',
							order_id: order,
							direction: 'sales',
							kind: 'invoice',
							reference: 'INV-SAME',
							seal_hash: seal,
							currency: 'SGD',
							status: 'issued',
							items: JSON.stringify([
								{
									order_line_id: line,
									product_name: 'Resin',
									unit: 'kg',
									quantity: '4',
									unit_price: '2'
								}
							]),
							documents: JSON.stringify([
								{
									name: 'invoice.pdf',
									url: 'https://example.test/invoice.pdf',
									sha256: 'a'.repeat(64)
								}
							]),
							issued_on: '2026-10-01',
							due_on: '2026-10-31',
							total: '8.72',
							source_updated_at: now
						}
					],
					'/source_payments': [
						{
							external_code: 'PAY-SAME',
							order_id: order,
							invoice_id: 'INV-SAME',
							kind: 'receipt',
							reference: 'RCPT-SAME',
							settled_on: '2026-10-05',
							source_updated_at: now,
							seal_hash: seal,
							currency: 'SGD',
							amount: '3',
							active: true
						}
					]
				};
			}
			for (const collection of ['ext_sales_orders', 'transactions', 'source_payments'])
				yield* pull(collection);
			for (const [ledger, own] of [
				[fixtureId('sys_integration', 'kingdee'), orders.first],
				[second, orders.second]
			] as const) {
				const parent = yield* one(
					t.as(t.admin).read('ext_sales_orders', {
						where: { source: { eq: ledger }, external_id: { eq: 'SO-SAME' } },
						all: true
					})
				);
				const invoice = yield* one(
					t.as(t.admin).read('transactions', {
						where: { source: { eq: ledger }, erp_id: { eq: 'INV-SAME' } },
						all: true
					})
				);
				expect(invoice).toMatchObject({ order: own.order, ext_sales_order: parent.id });
				expect(
					yield* one(
						t.as(t.admin).read('source_payments', {
							where: { source: { eq: ledger }, external_code: { eq: 'PAY-SAME' } },
							all: true
						})
					)
				).toMatchObject({
					order: own.order,
					invoice: invoice.id
				});
			}
		})
);
test.live('each confirmed order is submitted once, to its own ledger only', () =>
	Effect.gen(function* () {
		const submitted: {
			instance: string;
			order: Json | undefined;
			key: Json | undefined;
		}[] = [];
		const { t, second, records, pull } = yield* ledgers((instance, op) => {
			if (op.statement.includes('sp_getapplock'))
				submitted.push({ instance, order: op.parameters.order_id, key: op.parameters.key });
		});
		records.second = catalogue('Second');
		for (const collection of ['parties', 'products', 'warehouses']) yield* pull(collection);
		const first = yield* draft(t);
		yield* confirm(t, first.order);
		const own = yield* ledgerOrder(t, second);
		expect(yield* t.as(t.admin).get('orders', first.order)).toMatchObject({ ledger: 'kingdee' });
		expect(yield* t.as(t.admin).get('orders', own.order)).toMatchObject({ ledger: second });
		expect(yield* t.deliver()).toMatchObject({ sent: 2, failed: 0 });
		expect(yield* t.deliver()).toMatchObject({ sent: 0 });
		expect(submitted.map(({ instance, order }) => ({ instance, order }))).toEqual(
			expect.arrayContaining([
				{ instance: 'kingdee', order: first.order },
				{ instance: second, order: own.order }
			])
		);
		expect(submitted).toHaveLength(2);
		// an order never mixes ledgers: its warehouse and products come from its party's ledger
		const party = yield* one(
			t.as(t.admin).read('parties', {
				where: { source: { eq: second }, external_code: { eq: 'SAME-C' } },
				all: true
			})
		);
		expect(
			yield* Effect.flip(
				t.as(t.admin).act('orders.create', {
					title: 'Mixed',
					direction: 'sales',
					party: party.id,
					warehouse: fixtureId('warehouses', '00000000-0000-4000-8000-000000000301'),
					currency: 'SGD',
					payment_terms: 'Net 30'
				})
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.ledger_mismatch' });
		const mixed = committed(
			'orders',
			yield* t.as(t.admin).act('orders.create', {
				title: 'Mixed lines',
				direction: 'sales',
				party: party.id,
				currency: 'SGD',
				payment_terms: 'Net 30'
			})
		);
		expect(
			yield* Effect.flip(
				t.as(t.admin).act('order_lines.create', {
					order: mixed,
					product: PRODUCT,
					quantity: Decimal.of('1'),
					unit_price: Decimal.of('2'),
					discount_pct: Decimal.of('0'),
					tax_rate: Decimal.of('9')
				})
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.ledger_mismatch' });
	})
);
test.live('a Kingdee outage and a lost acknowledgement still create the order exactly once', () =>
	Effect.gen(function* () {
		const remote = new Map<string, string>();
		const keys = new Set<string>();
		let unreachable = 2,
			lose = true;
		const t = yield* workspace({
			source: (op) =>
				Effect.try({
					try: () => {
						if (unreachable > 0) {
							unreachable--;
							throw new Error('Kingdee is unreachable');
						}
						const key = String(op.parameters.key);
						keys.add(key);
						const created = remote.get(key) ?? randomUUID();
						remote.set(key, created);
						if (lose) {
							lose = false;
							throw new Error('The acknowledgement was lost');
						}
						return { rows: [{ remote: created, hash: op.parameters.hash ?? '' }] };
					},
					catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
				})
		});
		const own = yield* draft(t);
		yield* confirm(t, own.order);
		const state = Effect.fnUntraced(function* () {
			return firstRow(
				yield* t.db.read([
					{ text: "SELECT status FROM sys_message WHERE class = 'command'", params: [] }
				])
			).rows;
		});
		for (let attempt = 0; attempt < 3; attempt++) {
			expect(yield* t.deliver()).toMatchObject({ sent: 0, failed: 0 });
			expect(yield* state()).toEqual([{ status: 'queued' }]);
			t.clock.advance('10min');
		}
		expect(yield* t.deliver()).toMatchObject({ sent: 1, failed: 0 });
		t.clock.advance('10min');
		expect(yield* t.deliver()).toMatchObject({ sent: 0 });
		expect(yield* state()).toEqual([{ status: 'sent' }]);
		expect(remote.size).toBe(1);
		expect(keys.size).toBe(1);
	})
);
test.live('a ledger needing attention notifies configuration holders once', () =>
	Effect.gen(function* () {
		const fixture = sourceFixture(() => ({ '/parties': [] }));
		const t = yield* workspace({
			source: Effect.fnUntraced(function* (op: DatabaseRequest) {
				const answer = yield* fixture(op);
				// the capture clock reports a lag beyond the instance's 15 minute limit
				return op.statement.includes('SELECT sys.fn_cdc_get_max_lsn()')
					? { rows: answer.rows.map((row) => ({ ...row, lag: String(16 * 60000) })) }
					: answer;
			})
		});
		const configurator = t.member(['configuration'], {
			teams: ['Configurators'],
			teamPath: ['Configurators']
		});
		const sales = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
		yield* t.pull('parties');
		expect(
			yield* t.as(t.admin).get('sys_integration', fixtureId('sys_integration', 'kingdee'))
		).toMatchObject({
			status: { health: { state: 'attention', code: 'captureLag' } }
		});
		yield* t.runDue();
		yield* t.pull('parties');
		yield* t.runDue();
		const inbox = Effect.fnUntraced(function* (member: string) {
			return firstRow(
				yield* t.db.read([
					{ text: 'SELECT title, body FROM sys_notification WHERE member = $1', params: [member] }
				])
			).rows;
		});
		expect(yield* inbox(configurator.id)).toEqual([
			{
				title: 'kingdee needs attention',
				body: 'Change capture is behind the configured lag limit.'
			}
		]);
		expect(yield* inbox(sales.id)).toEqual([]);
	})
);
test.live(
	'a draft queues no command; each re-confirmed agreement version is submitted under its own key',
	() =>
		Effect.gen(function* () {
			const keys: string[] = [];
			const t = yield* workspace({
				source: (op) =>
					Effect.try({
						try: () => {
							keys.push(String(op.parameters.key));
							return { rows: [{ remote: `R-${keys.length}`, hash: op.parameters.hash ?? '' }] };
						},
						catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
					})
			});
			const commands = Effect.fnUntraced(function* () {
				return firstRow(
					yield* t.db.read([
						{
							text: "SELECT status FROM sys_message WHERE class = 'command' ORDER BY seq",
							params: []
						}
					])
				).rows;
			});
			const own = yield* draft(t);
			expect(yield* t.deliver()).toMatchObject({ sent: 0 });
			expect(yield* commands()).toEqual([]);
			yield* confirm(t, own.order);
			expect(yield* t.deliver()).toMatchObject({ sent: 1 });
			committed(
				'orders',
				yield* t
					.as(t.admin)
					.act('orders.revise', { target: own.order, input: { reason: 'Extended agreement' } })
			);
			committed(
				'orders',
				yield* t
					.as(t.admin)
					.act('orders.update', { target: own.order, set: { payment_terms: 'Net 60' } })
			);
			expect(yield* t.deliver()).toMatchObject({ sent: 0 });
			yield* confirm(t, own.order);
			t.clock.advance('1min');
			expect(yield* t.deliver()).toMatchObject({ sent: 1 });
			expect(yield* commands()).toEqual([{ status: 'sent' }, { status: 'sent' }]);
			expect(keys).toHaveLength(2);
			expect(new Set(keys).size).toBe(2);
		})
);
