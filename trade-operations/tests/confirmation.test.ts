import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId, sameDecimal } from './test-runtime.js';
import { committed, NET30, NET60 } from './kit.js';
import { documentOf } from './reads.js';
const CUSTOMER = fixtureId('parties', '00000000-0000-4000-8000-000000000101');
const PRODUCT = fixtureId('products', '00000000-0000-4000-8000-000000000201');
const EAST = fixtureId('warehouses', '00000000-0000-4000-8000-000000000301');
const WEST = fixtureId('warehouses', '00000000-0000-4000-8000-000000000302');
const KINGDEE_CONTACT = fixtureId('contacts', '00000000-0000-4000-8000-000000000601');
const syncWorkspace = (floor_rule: 'warn' | 'approve' | 'refuse' = 'warn') =>
	acquireWorkspace({
		root: process.cwd(),
		now: '2026-10-10T00:00:00Z',
		seed: {
			sys_integration: [
				{
					id: 'kingdee',
					integration: 'kingdee',
					name: 'kingdee',
					active: true,
					configuration: {
						baseCurrency: 'CNY',
						branchNo: '0',
						maxWindowMinutes: 15
					}
				}
			],
			settlements: [
				{
					id: NET30,
					external_code: '11',
					code: 'NET30',
					name: 'Net 30',
					active: true,
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				},
				{
					id: NET60,
					external_code: '12',
					code: 'NET60',
					name: 'Net 60',
					active: true,
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				}
			],
			parties: [
				{
					id: CUSTOMER,
					external_code: 'CUSTOMER',
					name: 'Synthetic customer',
					kind: 'customer',
					currency: 'SGD',
					active: true,
					address: '1 Test Road, Singapore',
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				}
			],
			contacts: [
				{
					id: KINGDEE_CONTACT,
					party: CUSTOMER,
					name: 'Li Wei',
					phone: '+6590000000',
					email: 'li.wei@example.com',
					primary: true
				}
			],
			warehouses: [
				{
					id: EAST,
					external_code: 'EAST',
					name: 'East warehouse',
					group_code: 'EAST',
					active: true,
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				},
				{
					id: WEST,
					external_code: 'WEST',
					name: 'West warehouse',
					group_code: 'WEST',
					active: true,
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				}
			],
			products: [
				{
					id: PRODUCT,
					external_code: 'PRODUCT',
					name: 'Synthetic product',
					unit: 'kg',
					currency: 'SGD',
					unit_price: '2',
					tax_rate: '9',
					active: true,
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				}
			],
			pricing_floors: [
				{
					id: '00000000-0000-4000-8000-000000000701',
					product: PRODUCT,
					group_code: 'EAST',
					currency: 'SGD',
					effective_on: '2026-10-01',
					minimum_quantity: '0',
					unit: 'kg',
					floor_price: '1.5',
					tax_inclusive: false,
					tax_rate: '0'
				}
			],
			commercial_settings: [
				{
					id: '00000000-0000-4000-8000-000000000401',
					code: 'default',
					floor_rule,
					stock_fresh_minutes: 30
				}
			],
			document_templates: [
				{
					id: '00000000-0000-4000-8000-000000000502',
					kind: 'sales_contract',
					locale: 'en',
					version: '1',
					title: 'Synthetic agreement',
					body: '{agreement}',
					status: 'published',
					published_at: '2026-01-01T00:00:00Z'
				}
			]
		}
	});
/** A sales draft at the East warehouse with one 10 kg line at 2 SGD, 9% tax exclusive (21.80). */
const draftWithLine = Effect.fnUntraced(function* (
	t: Effect.Success<ReturnType<typeof syncWorkspace>>,
	unit_price = '2'
) {
	const as = yield* t.as(t.admin);
	const order = committed(
		'orders',
		yield* as.act({
			'orders.create': [
				{
					title: 'Sales order',
					direction: 'sales',
					party: CUSTOMER,
					warehouse: EAST,
					currency: 'SGD',
					payment_terms: NET30
				}
			]
		})
	);
	const line = committed(
		'order_lines',
		yield* as.act({
			'order_lines.create': [
				{ order, product: PRODUCT, quantity: '10', unit_price, discount_pct: '0', tax_rate: '9' }
			]
		})
	);
	return { as, order, line };
});
const orderOf = Effect.fnUntraced(function* (
	as: Effect.Success<ReturnType<Effect.Success<ReturnType<typeof syncWorkspace>>['as']>>,
	order: ReturnType<typeof committed<'orders'>>
) {
	return (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0];
});

test.live('syncing once leaves Kingdee the header; terms and lines stay editable', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order, line } = yield* draftWithLine(t);
		committed(
			'orders',
			yield* as.act({
				'orders.update': [{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }]
			})
		);
		const synced = yield* orderOf(as, order);
		expect(synced).toMatchObject({ status: 'confirmed', payment_terms: NET30 });
		expect(sameDecimal(synced?.total, '21.80')).toBe(true);
		for (const set of [{ currency: 'USD' }, { payment_terms: NET60 }] as const)
			expect(
				yield* Effect.flip(
					as.act({ 'orders.update': [{ target: yield* t.at('orders', order), set }] })
				)
			).toMatchObject({ _tag: 'ActRefused', key: 'errors.kingdee_header' });
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { shipping_terms: 'fob', place_of_loading: 'Shanghai' }
					}
				]
			})
		);
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', line), set: { unit_price: '3' } }
				]
			})
		);
		const edited = yield* orderOf(as, order);
		expect(edited).toMatchObject({ status: 'confirmed', shipping_terms: 'fob' });
		expect(sameDecimal(edited?.total, '32.70')).toBe(true);
	})
);

test.live('a draft re-prices its lines when its pricing basis moves', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order, line } = yield* draftWithLine(t);
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{ target: yield* t.at('orders', order), set: { tax_inclusive: true, warehouse: WEST } }
				]
			})
		);
		expect(sameDecimal((yield* orderOf(as, order))?.total, '20.00')).toBe(true);
		const priced = (yield* as.query({ order_lines: { where: { id: { eq: line } }, limit: 1 } }))
			.order_lines.rows[0];
		// the West group has no floor
		expect(priced).toMatchObject({ floor_net: null, floor_on: null });
	})
);

test.live('a draft with no lines or no payment terms does not sync', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const as = yield* t.as(t.admin);
		const empty = committed(
			'orders',
			yield* as.act({
				'orders.create': [
					{ title: 'Empty draft', direction: 'sales', party: CUSTOMER, currency: 'SGD' }
				]
			})
		);
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [{ target: yield* t.at('orders', empty), set: { status: 'confirmed' } }]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', key: 'errors.lines_required' });
		yield* as.act({
			'order_lines.create': [
				{ order: empty, product: PRODUCT, quantity: '1', unit_price: '2', tax_rate: '9' }
			]
		});
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [{ target: yield* t.at('orders', empty), set: { status: 'confirmed' } }]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', key: 'errors.payment_terms' });
	})
);

test.live('places and the buyer follow the warehouse and party until typed over', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order } = yield* draftWithLine(t);
		expect(yield* orderOf(as, order)).toMatchObject({
			place_of_loading: 'East warehouse',
			delivery_address: '1 Test Road, Singapore',
			buyer_contact: KINGDEE_CONTACT
		});
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { warehouse: WEST } }]
		});
		expect(yield* orderOf(as, order)).toMatchObject({ place_of_loading: 'West warehouse' });
		yield* as.act({
			'orders.update': [
				{ target: yield* t.at('orders', order), set: { place_of_loading: 'Shanghai port' } }
			]
		});
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { warehouse: EAST } }]
		});
		expect(yield* orderOf(as, order)).toMatchObject({ place_of_loading: 'Shanghai port' });
	})
);

test.live('a document prints the buyer contact, payment terms and shipment window', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order } = yield* draftWithLine(t);
		yield* as.act({
			'orders.update': [
				{
					target: yield* t.at('orders', order),
					set: {
						shipping_terms: 'fob',
						payment_method: 'acceptance_bill',
						shipment: { from: '2026-10-10', to: '2026-10-25' }
					}
				}
			]
		});
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }]
		});
		const document = yield* documentOf(as, { order });
		expect(document.html).toContain('Net 30');
		expect(document.html).toContain('FOB');
		expect(document.html).toContain('2026-10-10 – 2026-10-25');
	})
);

test.live('the refuse floor rule refuses a sales line below or without its floor', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace('refuse');
		const as = yield* t.as(t.admin);
		const below = yield* Effect.flip(draftWithLine(t, '1'));
		expect(below).toMatchObject({ _tag: 'ActRefused', key: 'errors.floor_below' });
		const { order } = yield* draftWithLine(t);
		// moving the order to a group with no floor re-prices its line, which the rule refuses
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [{ target: yield* t.at('orders', order), set: { warehouse: WEST } }]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', key: 'errors.floor_missing' });
	})
);
