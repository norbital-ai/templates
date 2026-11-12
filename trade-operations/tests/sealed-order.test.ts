import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import { committed } from './kit.js';
import { confirmationOf } from './reads.js';
const sealingWorkspace = () =>
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
						fullSnapshotMinutes: 1440,
						maxWindowMinutes: 15
					}
				}
			],
			parties: [
				{
					id: '00000000-0000-4000-8000-000000000101',
					external_code: 'CUSTOMER',
					name: 'Synthetic customer',
					kind: 'customer',
					currency: 'SGD',
					active: true,
					source_updated_at: '2026-10-10T00:00:00Z',
					source: 'kingdee'
				}
			],
			products: [
				{
					id: '00000000-0000-4000-8000-000000000201',
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
			commercial_settings: [
				{
					id: '00000000-0000-4000-8000-000000000401',
					code: 'default',
					default_document_layout: '00000000-0000-4000-8000-000000000502',
					require_floor: false,
					credit_fresh_minutes: 60,
					stock_fresh_minutes: 30
				}
			],
			document_templates: [
				{
					id: '00000000-0000-4000-8000-000000000502',
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
test.live('confirmation seals this SO and blocks all subsequent commercial edits', () =>
	Effect.gen(function* () {
		const t = yield* sealingWorkspace();
		const as = yield* t.as(t.admin);
		const order = committed(
			'orders',
			yield* as.act({
				'orders.create': [
					{
						title: 'Sealed SO',
						direction: 'sales',
						party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
						currency: 'SGD',
						payment_terms: 'Net 30'
					}
				]
			})
		);
		const line = committed(
			'order_lines',
			yield* as.act({
				'order_lines.create': [
					{
						order,
						product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
						quantity: Decimal.of('10'),
						unit_price: Decimal.of('2'),
						discount_pct: Decimal.of('0'),
						tax_rate: Decimal.of('9')
					}
				]
			})
		);
		const check = yield* confirmationOf(as, {
			as_of: Instant(t.clock.now()),
			order
		});
		expect(check).toHaveProperty('check_hash');
		const checked = check;
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { status: 'confirmed', check_hash: checked.check_hash }
					}
				]
			})
		);
		const before = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
			.rows[0];
		expect(before).toMatchObject({ status: 'confirmed', sealed_contract_version: '1' });
		expect(before?.sealed_snapshot).toMatchObject({ total: '21.80', payment_terms: 'Net 30' });
		expect(before?.agreed_total?.eq('21.80')).toBe(true);
		expect(before?.sealed_contract).toContain('Net 30');
		expect(before?.sealed_contract).toContain(before?.number);
		expect(before?.sealed_contract).not.toContain(order);
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [
						{ target: yield* t.at('orders', order), set: { payment_terms: 'Net 90' } }
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* Effect.flip(
				as.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', line), set: { unit_price: Decimal.of('99') } }
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* Effect.flip(
				as.act({ 'order_lines.delete': [{ target: yield* t.at('order_lines', line) }] })
			)
		).toMatchObject({
			_tag: 'ActRefused'
		});
		const nextTemplate = committed(
			'document_templates',
			yield* as.act({
				'document_templates.create': [
					{
						locale: 'en',
						version: '2',
						title: 'New terms',
						body: '{agreement}\nNew contract wording'
					}
				]
			})
		);
		committed(
			'document_templates',
			yield* as.act({
				'document_templates.update': [
					{ target: yield* t.at('document_templates', nextTemplate), set: { status: 'published' } }
				]
			})
		);
		const after = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
			.rows[0];
		expect(after?.seal_hash).toEqual(before?.seal_hash);
		expect(after?.sealed_snapshot).toEqual(before?.sealed_snapshot);
		expect(after?.sealed_contract).toEqual(before?.sealed_contract);
	})
);
test.live('a credit acknowledgment cannot confirm changed pricing or another SO', () =>
	Effect.gen(function* () {
		const t = yield* sealingWorkspace();
		const as = yield* t.as(t.admin);
		const createOrder = Effect.fnUntraced(function* (title: string) {
			return committed(
				'orders',
				yield* as.act({
					'orders.create': [
						{
							title,
							direction: 'sales',
							party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
							currency: 'SGD',
							payment_terms: 'Net 30'
						}
					]
				})
			);
		});
		const first = yield* createOrder('First SO');
		const second = yield* createOrder('Second SO');
		const line = committed(
			'order_lines',
			yield* as.act({
				'order_lines.create': [
					{
						order: first,
						product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
						quantity: Decimal.of('10'),
						unit_price: Decimal.of('2'),
						discount_pct: Decimal.of('0'),
						tax_rate: Decimal.of('9')
					}
				]
			})
		);
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.create': [
					{
						order: second,
						product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
						quantity: Decimal.of('10'),
						unit_price: Decimal.of('2'),
						discount_pct: Decimal.of('0'),
						tax_rate: Decimal.of('9')
					}
				]
			})
		);
		const check = yield* confirmationOf(as, {
			as_of: Instant(t.clock.now()),
			order: first
		});
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [
						{
							target: yield* t.at('orders', second),
							set: { status: 'confirmed', check_hash: check.check_hash }
						}
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.check_changed' });
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', line), set: { unit_price: Decimal.of('3') } }
				]
			})
		);
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [
						{
							target: yield* t.at('orders', first),
							set: { status: 'confirmed', check_hash: check.check_hash }
						}
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.check_changed' });
		const refreshed = yield* confirmationOf(as, {
			as_of: Instant(t.clock.now()),
			order: first
		});
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', first),
						set: { status: 'confirmed', check_hash: refreshed.check_hash }
					}
				]
			})
		);
		expect(
			(yield* as.query({ orders: { where: { id: { eq: first } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			sealed_snapshot: { total: '32.70' }
		});
		expect(
			(yield* as.query({ orders: { where: { id: { eq: second } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			status: 'draft',
			sealed_snapshot: null,
			seal_hash: null
		});
	})
);

test.live('a draft with no lines is refused before any confirmation', () =>
	Effect.gen(function* () {
		const t = yield* sealingWorkspace();
		const as = yield* t.as(t.admin);
		const order = committed(
			'orders',
			yield* as.act({
				'orders.create': [
					{
						title: 'Empty draft',
						direction: 'sales',
						party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
						currency: 'SGD',
						payment_terms: 'Net 30'
					}
				]
			})
		);
		expect(
			yield* Effect.flip(confirmationOf(as, { as_of: Instant(t.clock.now()), order }))
		).toMatchObject({ message: 'errors.lines_required' });
	})
);

test.live('commercial trade and shipping fields stay queryable and are retained by the seal', () =>
	Effect.gen(function* () {
		const t = yield* sealingWorkspace();
		const as = yield* t.as(t.admin);
		const order = committed(
			'orders',
			yield* as.act({
				'orders.create': [
					{
						title: 'Trade terms',
						direction: 'sales',
						party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
						currency: 'SGD',
						payment_terms: 'Net 30',
						shipping_terms: 'FOB Shanghai',
						place_of_loading: 'Shanghai',
						place_of_delivery: 'Singapore',
						packaging: '25kg/bag',
						shipping_mark: 'EPG/TEST',
						time_of_shipment: 'October 2026',
						other_terms: 'Arbitration in Singapore',
						payment_method: 'acceptance',
						buyer_contact: 'Li Wei',
						buyer_mobile: '+6590000000',
						delivery_address: '1 Test Road, Singapore',
						delivery_date: PlainDate('2026-10-20')
					}
				]
			})
		);
		yield* as.act({
			'order_lines.create': [
				{
					order,
					product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
					quantity: Decimal.of('10'),
					unit_price: Decimal.of('2'),
					discount_pct: Decimal.of('0'),
					tax_rate: Decimal.of('9')
				}
			]
		});
		const check = yield* confirmationOf(as, { order, as_of: Instant(t.clock.now()) });
		yield* as.act({
			'orders.update': [
				{
					target: yield* t.at('orders', order),
					set: { status: 'confirmed', check_hash: check.check_hash }
				}
			]
		});
		const row = (yield* as.query({
			orders: {
				where: { id: { eq: order } },
				fields: [
					'shipping_terms',
					'place_of_loading',
					'place_of_delivery',
					'packaging',
					'shipping_mark',
					'time_of_shipment',
					'other_terms',
					'payment_method',
					'buyer_contact',
					'buyer_mobile',
					'delivery_address',
					'delivery_date',
					'sealed_snapshot'
				],
				limit: 1
			}
		})).orders.rows[0];
		expect(row).toMatchObject({
			shipping_terms: 'FOB Shanghai',
			place_of_loading: 'Shanghai',
			place_of_delivery: 'Singapore',
			packaging: '25kg/bag',
			shipping_mark: 'EPG/TEST',
			time_of_shipment: 'October 2026',
			other_terms: 'Arbitration in Singapore',
			payment_method: 'acceptance',
			buyer_contact: 'Li Wei',
			buyer_mobile: '+6590000000',
			delivery_address: '1 Test Road, Singapore',
			delivery_date: '2026-10-20'
		});
		expect(row?.sealed_snapshot).toMatchObject({
			shipping_terms: 'FOB Shanghai',
			place_of_delivery: 'Singapore',
			buyer_contact: 'Li Wei',
			delivery_address: '1 Test Road, Singapore'
		});
	})
);
