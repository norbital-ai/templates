import { Effect } from 'effect';
import { layer } from '@effect/vitest';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { CUSTOMER, Trade, shared, draft, committed } from './kit.js';
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
});
