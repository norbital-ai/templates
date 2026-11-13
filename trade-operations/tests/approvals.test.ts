import { Effect } from 'effect';
import { layer } from '@effect/vitest';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { CUSTOMER, Trade, shared, draft, confirm, committed } from './kit.js';
import { confirmationOf } from './reads.js';
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

	test.effect('a sales rep adding a party contact waits for a commercial manager', () =>
		Effect.gen(function* () {
			const { sales, manager } = yield* people;
			const request = held(yield* sales.act({ 'contacts.create': [contact('Buyer 1')] }));
			yield* Effect.flip(sales.approvals.decide(request, { decision: 'approve' }));
			yield* manager.approvals.decide(request, { decision: 'approve' });
			committed('contacts', yield* manager.act({ 'contacts.create': [contact('Buyer 2')] }));
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

	test.effect('a sales rep confirming an own order waits for a commercial manager', () =>
		Effect.gen(function* () {
			const { t, seller, sales, manager } = yield* people;
			const { order } = yield* draft(t, 'sales', fixtureId('sys_user', seller.id));
			const check = yield* confirmationOf(sales, { order, as_of: t.clock.now() });
			const request = held(
				yield* sales.act({
					'orders.update': [
						{
							target: yield* t.at('orders', order),
							set: { status: 'confirmed', check_hash: check.check_hash }
						}
					]
				})
			);
			yield* Effect.flip(sales.approvals.decide(request, { decision: 'approve' }));
			yield* manager.approvals.decide(request, { decision: 'approve' });
		})
	);

	test.effect(
		'a sales rep changing a confirmed order or its lines waits for a commercial manager',
		() =>
			Effect.gen(function* () {
				const { t, seller, sales, manager } = yield* people;
				const { order, line } = yield* draft(t, 'sales', fixtureId('sys_user', seller.id));
				yield* confirm(t, order);
				const terms = held(
					yield* sales.act({
						'orders.update': [
							{ target: yield* t.at('orders', order), set: { payment_terms: 'Net 60' } }
						]
					})
				);
				yield* manager.approvals.decide(terms, { decision: 'approve' });
				const quantity = held(
					yield* sales.act({
						'order_lines.update': [
							{ target: yield* t.at('order_lines', line), set: { quantity: '12' } }
						]
					})
				);
				yield* manager.approvals.decide(quantity, { decision: 'approve' });
				// remarks stay the rep's own
				committed(
					'orders',
					yield* sales.act({
						'orders.update': [
							{ target: yield* t.at('orders', order), set: { notes: 'Called buyer' } }
						]
					})
				);
			})
	);
});
