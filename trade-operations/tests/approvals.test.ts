import { Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { CUSTOMER, PRODUCT, SETTINGS, Trade, shared, draft, committed, NET30 } from './kit.js';
import { fixtureId } from './test-runtime.js';
const held = (outcome: NativeActAnswer) => {
	if (outcome.kind !== 'pending_approval') throw new Error(JSON.stringify(outcome));
	return outcome.request_id;
};
// which writes the sales policy holds and who decides them; what a decision does is Bolt's
layer(shared(), { excludeTestServices: true })('commercial review', (test) => {
	const people = Effect.gen(function* () {
		const t = yield* Trade;
		const seller = t.member(['sales'], { teams: ['sales'] });
		const manager = yield* t.as(t.member(['manager'], { teams: ['commercial_managers'] }));
		return { t, seller, sales: yield* t.as(seller), manager };
	});
	const contact = (name: string) => ({ party: CUSTOMER, name, job_title: 'Buyer' });

	test.effect('a sales rep adds contacts directly; the Kingdee contact changes only there', () =>
		Effect.gen(function* () {
			const { t, sales } = yield* people;
			committed('contacts', yield* sales.act({ 'contacts.create': [contact('Buyer 1')] }));
			const admin = yield* t.as(t.admin);
			const kingdee = committed(
				'contacts',
				yield* admin.act({ 'contacts.create': [{ ...contact('Kingdee buyer'), primary: true }] })
			);
			expect(
				yield* Effect.flip(
					sales.act({
						'contacts.update': [
							{ target: yield* t.at('contacts', kingdee), set: { job_title: 'Owner' } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused', key: 'errors.kingdee_contact' });
		})
	);

	test.effect('a sales rep deleting an own draft waits for a commercial manager', () =>
		Effect.gen(function* () {
			const { t, seller, sales, manager } = yield* people;
			const { order } = yield* draft(t, 'sales', fixtureId('sys_user', seller.id));
			const request = held(
				yield* sales.act({ 'orders.delete': [{ target: yield* t.at('orders', order) }] })
			);
			yield* Effect.flip(sales.approvals.decide(request, { decision: 'approve' }));
			yield* manager.approvals.decide(request, { decision: 'approve' });
		})
	);

	test.effect('a sales rep syncs an own order and changes it after, directly', () =>
		Effect.gen(function* () {
			const { t, seller, sales } = yield* people;
			const { order, line } = yield* draft(t, 'sales', fixtureId('sys_user', seller.id));
			committed(
				'orders',
				yield* sales.act({
					'orders.update': [{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }]
				})
			);
			committed(
				'order_lines',
				yield* sales.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', line), set: { quantity: '12' } }
					]
				})
			);
			committed(
				'orders',
				yield* sales.act({
					'orders.update': [
						{
							target: yield* t.at('orders', order),
							set: { trade: { kind: 'foreign', shipping_terms: 'cif' } }
						}
					]
				})
			);
		})
	);

	test.effect(
		'under the approve floor rule a line without a floor waits, and so does the sync',
		() =>
			Effect.gen(function* () {
				const { t, seller, sales, manager } = yield* people;
				const admin = yield* t.as(t.admin);
				const rule = (floor_rule: 'warn' | 'approve') =>
					Effect.gen(function* () {
						committed(
							'commercial_settings',
							yield* admin.act({
								'commercial_settings.update': [
									{ target: yield* t.at('commercial_settings', SETTINGS), set: { floor_rule } }
								]
							})
						);
					});
				yield* rule('approve');
				const order = committed(
					'orders',
					yield* sales.act({
						'orders.create': [
							{
								title: 'Below floor',
								direction: 'sales',
								party: CUSTOMER,
								owner: fixtureId('sys_user', seller.id),
								currency: 'SGD',
								payment_terms: NET30
							}
						]
					})
				);
				const request = held(
					yield* sales.act({
						'order_lines.create': [
							{ order, product: PRODUCT, quantity: '10', unit_price: '2', tax_rate: '9' }
						]
					})
				);
				expect(
					yield* Effect.flip(
						sales.act({
							'orders.update': [
								{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused', key: 'errors.lines_pending' });
				yield* manager.approvals.decide(request, { decision: 'approve' });
				committed(
					'orders',
					yield* sales.act({
						'orders.update': [
							{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }
						]
					})
				);
				yield* rule('warn');
			})
	);

	test.effect(
		'converts tonne pricing floors to kg products and lets a commercial manager approve a held order create',
		() =>
			Effect.gen(function* () {
				const { t, seller, sales, manager } = yield* people;
				const admin = yield* t.as(t.admin);
				const west = fixtureId('warehouses', '019b76dc-6d20-7000-9891-d6e4d7d9cd57');
				const rule = (floor_rule: 'warn' | 'approve') =>
					Effect.gen(function* () {
						committed(
							'commercial_settings',
							yield* admin.act({
								'commercial_settings.update': [
									{ target: yield* t.at('commercial_settings', SETTINGS), set: { floor_rule } }
								]
							})
						);
					});
				// 22,000 CNY/吨 tax-exclusive floor -> 22.00 CNY/kg for kg product
				committed(
					'pricing_floors',
					yield* admin.act({
						'pricing_floors.create': [
							{
								product: PRODUCT,
								currency: 'CNY',
								group_code: 'WEST',
								effective_on: '2026-10-01',
								minimum_quantity: '0',
								unit: '吨',
								floor_price: '22000',
								tax_inclusive: false
							}
						]
					})
				);
				yield* rule('approve');
				// Above floor (25 CNY/kg > 22 CNY/kg) saves directly without approval
				const aboveId = committed(
					'orders',
					yield* sales.act({
						'orders.create': [
							{
								title: 'Above tonne floor',
								direction: 'sales',
								party: CUSTOMER,
								owner: fixtureId('sys_user', seller.id),
								warehouse: west,
								currency: 'CNY',
								tax_inclusive: false,
								payment_terms: NET30,
								lines: [{ product: PRODUCT, quantity: '4000', unit_price: '25', tax_rate: '13' }]
							}
						]
					})
				);
				expect(aboveId).toBeTruthy();
				// Below floor (20 CNY/kg < 22 CNY/kg) holds on create and manager approval succeeds
				const createRequest = held(
					yield* sales.act({
						'orders.create': [
							{
								title: 'Below tonne floor create',
								direction: 'sales',
								party: CUSTOMER,
								owner: fixtureId('sys_user', seller.id),
								warehouse: west,
								currency: 'CNY',
								tax_inclusive: false,
								payment_terms: NET30,
								lines: [{ product: PRODUCT, quantity: '4000', unit_price: '20', tax_rate: '13' }]
							}
						]
					})
				);
				yield* manager.approvals.decide(createRequest, { decision: 'approve' });
				const approvedOrder = (yield* sales.query({
					orders: { where: { title: { eq: 'Below tonne floor create' } }, fields: ['id', 'status'] }
				})).orders.rows[0];
				expect(approvedOrder?.status).toBe('draft');
				expect(approvedOrder?.$approval).toBeUndefined();

				// Incompatible floor unit (box vs kg) still refuses with errors.unit_mismatch
				committed(
					'pricing_floors',
					yield* admin.act({
						'pricing_floors.create': [
							{
								product: PRODUCT,
								currency: 'EUR',
								group_code: 'WEST',
								effective_on: '2026-10-01',
								minimum_quantity: '0',
								unit: 'box',
								floor_price: '100',
								tax_inclusive: false
							}
						]
					})
				);
				expect(
					yield* Effect.flip(
						sales.act({
							'orders.create': [
								{
									title: 'Incompatible unit floor',
									direction: 'sales',
									party: CUSTOMER,
									owner: fixtureId('sys_user', seller.id),
									warehouse: west,
									currency: 'EUR',
									tax_inclusive: false,
									payment_terms: NET30,
									lines: [{ product: PRODUCT, quantity: '10', unit_price: '120', tax_rate: '0' }]
								}
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused', key: 'errors.unit_mismatch' });

				yield* rule('warn');
			})
	);
});
