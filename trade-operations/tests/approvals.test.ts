import { Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { CUSTOMER, Trade, shared, draft, committed } from './kit.js';
import { fixtureId } from './test-runtime.js';
const held = (outcome: NativeActAnswer) => {
	if (outcome.kind !== 'pending_approval') throw new Error(JSON.stringify(outcome));
	const record = outcome.records.find(
		(record) => record.model === 'contacts' || record.model === 'orders'
	);
	if (record === undefined) throw new Error('The request holds no record');
	return { request: outcome.request_id, id: record.id };
};
layer(shared(), { excludeTestServices: true })('commercial review', (test) => {
	const people = Effect.gen(function* () {
		const t = yield* Trade;
		const seller = t.member(['sales'], { teams: ['sales'] });
		const manager = yield* t.as(t.member(['manager'], { teams: ['commercial_managers'] }));
		return { t, seller, sales: yield* t.as(seller), manager };
	});
	const contact = (name: string) => ({ party: CUSTOMER, name, job_title: 'Buyer' });

	test.effect('a sales rep adding a party contact waits for review; a manager adds directly', () =>
		Effect.gen(function* () {
			const { sales, manager } = yield* people;
			const contacts = (id: string) =>
				manager
					.query({ contacts: { where: { id: { eq: fixtureId('contacts', id) } } } })
					.pipe(Effect.map((answer) => answer.contacts.rows));
			const approved = held(yield* sales.act({ 'contacts.create': [contact('Buyer 1')] }));
			yield* manager.approvals.decide(approved.request, { decision: 'approve' });
			expect(yield* contacts(approved.id)).toMatchObject([{ name: 'Buyer 1' }]);

			const rejected = held(yield* sales.act({ 'contacts.create': [contact('Buyer 2')] }));
			yield* manager.approvals.decide(rejected.request, {
				decision: 'reject',
				reason: 'Already on file'
			});
			expect(yield* contacts(rejected.id)).toEqual([]);

			const withdrawn = held(yield* sales.act({ 'contacts.create': [contact('Buyer 3')] }));
			yield* sales.approvals.decide(withdrawn.request, { decision: 'withdraw' });
			expect(yield* contacts(withdrawn.id)).toEqual([]);

			committed('contacts', yield* manager.act({ 'contacts.create': [contact('Buyer 4')] }));
		})
	);

	test.effect('requested changes are saved back into the same request', () =>
		Effect.gen(function* () {
			const { t, sales, manager } = yield* people;
			const asked = held(yield* sales.act({ 'contacts.create': [contact('Buyer 5')] }));
			yield* manager.approvals.decide(asked.request, {
				decision: 'request_changes',
				reason: 'Use her full name'
			});
			expect(
				yield* sales.act({
					'contacts.update': [
						{
							target: yield* t.at('contacts', fixtureId('contacts', asked.id)),
							set: { name: 'Mei Tan' }
						}
					]
				})
			).toMatchObject({ kind: 'pending_approval', request_id: asked.request });
			yield* manager.approvals.decide(asked.request, { decision: 'approve' });
			const { contacts } = yield* manager.query({
				contacts: { where: { id: { eq: fixtureId('contacts', asked.id) } } }
			});
			expect(contacts.rows).toMatchObject([{ name: 'Mei Tan' }]);
		})
	);

	test.effect('a sales rep deleting a draft waits for review; a rejection keeps the order', () =>
		Effect.gen(function* () {
			const { t, seller, sales, manager } = yield* people;
			const orders = (id: string) =>
				manager
					.query({ orders: { where: { id: { eq: fixtureId('orders', id) } } } })
					.pipe(Effect.map((answer) => answer.orders.rows));
			const kept = yield* draft(t, 'sales', fixtureId('sys_user', seller.id));
			const rejected = held(
				yield* sales.act({ 'orders.delete': [{ target: yield* t.at('orders', kept.order) }] })
			);
			yield* manager.approvals.decide(rejected.request, {
				decision: 'reject',
				reason: 'The customer still wants it'
			});
			expect(yield* orders(kept.order)).toHaveLength(1);

			const gone = yield* draft(t, 'sales', fixtureId('sys_user', seller.id));
			const approved = held(
				yield* sales.act({ 'orders.delete': [{ target: yield* t.at('orders', gone.order) }] })
			);
			yield* manager.approvals.decide(approved.request, { decision: 'approve' });
			expect(yield* orders(gone.order)).toEqual([]);
		})
	);
});
