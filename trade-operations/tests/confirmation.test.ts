import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId, sameDecimal } from './test-runtime.js';
import { committed, NET30, NET60 } from './kit.js';
import { documentOf } from './reads.js';
const CUSTOMER = fixtureId('parties', '019b76dc-51c8-7000-a2d1-819d9cbbbf03');
const PRODUCT = fixtureId('products', '019b76dc-5d80-7000-b01f-e12b4af40d08');
const EAST = fixtureId('warehouses', '019b76dc-6d20-7000-9891-d6e4d7d9cd57');
const WEST = fixtureId('warehouses', '019b76dc-ee08-7000-9543-d61f576d4e4a');
const KINGDEE_CONTACT = fixtureId('contacts', '00000000-0000-4000-8000-000000000601');
const syncWorkspace = (floor_rule: 'warn' | 'approve' | 'refuse' = 'warn') =>
	acquireWorkspace({
		root: process.cwd(),
		now: '2026-10-10T00:00:00Z',
		seed: {
			sys_team: [
				{ id: 'logistics', name: 'Logistics', policies: ['logistics'] },
				{ id: 'commercial_managers', name: 'Commercial Managers', policies: ['manager'] }
			],
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
					unit: 'kg',
					floor_price: '1.5',
					tax_inclusive: false,
					tax_rate: '0'
				}
			],
			commercial_settings: [
				{
					id: '019b76dc-3670-7000-9684-acb01c0f3440',
					code: 'default',
					floor_rule,
					stock_fresh_minutes: 30
				}
			],
			document_templates: [
				{
					id: '019b76dc-6938-7000-96b3-d968c091792a',
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
					trade: { kind: 'foreign' },
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
						set: { trade: { kind: 'foreign', shipping_terms: 'fob', place_of_loading: 'Shanghai' } }
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
		expect(edited).toMatchObject({
			status: 'confirmed',
			trade: { kind: 'foreign', shipping_terms: 'fob' }
		});
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

test.live(
	'an order starts with payment terms and keeps them; a draft with no lines does not sync',
	() =>
		Effect.gen(function* () {
			const t = yield* syncWorkspace();
			const as = yield* t.as(t.admin);
			const header = {
				title: 'Empty draft',
				direction: 'sales',
				party: CUSTOMER,
				currency: 'SGD'
			} as const;
			expect(yield* Effect.flip(as.act({ 'orders.create': [header] }))).toMatchObject({
				_tag: 'ActRefused',
				key: 'errors.payment_terms_required'
			});
			const empty = committed(
				'orders',
				yield* as.act({ 'orders.create': [{ ...header, payment_terms: NET30 }] })
			);
			expect(
				yield* Effect.flip(
					as.act({
						'orders.update': [
							{ target: yield* t.at('orders', empty), set: { payment_terms: null } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused', key: 'errors.payment_terms_required' });
			expect(
				yield* Effect.flip(
					as.act({
						'orders.update': [
							{ target: yield* t.at('orders', empty), set: { status: 'confirmed' } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused', key: 'errors.lines_required' });
		})
);

test.live('the logistics handler is one of the Logistics team', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order } = yield* draftWithLine(t);
		const handler = fixtureId('sys_user', t.member(['logistics'], { teams: ['logistics'] }).id);
		const sales = t.member(['sales'], { teams: ['sales'] });
		const seller = fixtureId('sys_user', sales.id);
		// the picker's list: a seller sees the Logistics staff, not other sellers
		const reader = yield* t.as(sales);
		const { sys_team } = yield* reader.query({
			sys_team: { where: { policies: { has: 'logistics' } }, fields: ['id'] }
		});
		const staff = yield* reader.query({
			sys_user: { where: { team: { in: sys_team.rows.map((team) => team.id) } } }
		});
		expect(staff.sys_user.rows.map((u) => u.id)).toEqual([handler]);
		const set = (logistics_handler: typeof handler) =>
			Effect.gen(function* () {
				return yield* as.act({
					'orders.update': [{ target: yield* t.at('orders', order), set: { logistics_handler } }]
				});
			});
		committed('orders', yield* set(handler));
		expect(yield* Effect.flip(set(seller))).toMatchObject({
			_tag: 'ActRefused',
			key: 'errors.logistics_handler'
		});
	})
);

test.live('places and the buyer follow the warehouse and party until typed over', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order } = yield* draftWithLine(t);
		expect(yield* orderOf(as, order)).toMatchObject({
			trade: { kind: 'foreign', place_of_loading: 'East warehouse' },
			delivery_address: '1 Test Road, Singapore',
			buyer_contact: KINGDEE_CONTACT
		});
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { warehouse: WEST } }]
		});
		expect(yield* orderOf(as, order)).toMatchObject({
			trade: { kind: 'foreign', place_of_loading: 'West warehouse' }
		});
		yield* as.act({
			'orders.update': [
				{
					target: yield* t.at('orders', order),
					set: { trade: { kind: 'foreign', place_of_loading: 'Shanghai port' } }
				}
			]
		});
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { warehouse: EAST } }]
		});
		expect(yield* orderOf(as, order)).toMatchObject({
			trade: { kind: 'foreign', place_of_loading: 'Shanghai port' }
		});
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
						payment_method: 'acceptance_bill',
						trade: {
							kind: 'foreign',
							shipping_terms: 'fob',
							shipment: { from: '2026-10-10', to: '2026-10-25' }
						}
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

test.live('a domestic delivery date prints and foreign fields cannot be stored on it', () =>
	Effect.gen(function* () {
		const t = yield* syncWorkspace();
		const { as, order } = yield* draftWithLine(t);
		const trade = {
			kind: 'domestic',
			delivery_date: '2026-11-09',
			delivery_place: 'Gate 2'
		} as const;
		yield* as.act({ 'orders.update': [{ target: yield* t.at('orders', order), set: { trade } }] });
		expect((yield* orderOf(as, order))?.trade).toEqual(trade);
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }]
		});
		expect((yield* documentOf(as, { order })).html).toContain('2026-11-09');
		const mixed = { ...trade, shipping_mark: 'Export only' };
		yield* Effect.flip(
			as.act({ 'orders.update': [{ target: yield* t.at('orders', order), set: { trade: mixed } }] })
		);
		expect((yield* orderOf(as, order))?.trade).toEqual(trade);
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
