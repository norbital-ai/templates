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
						{ target: yield* t.at('orders', order), set: { shipping_terms: 'cif' } }
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
});
