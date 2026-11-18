import { JobResult } from '@norbital-ai/bolt-cli/test';
import { expect, it } from '@effect/vitest';
import { workspace, member, required, recordOf, runRows, pageOf, targetOf } from './workspace.js';
import { Effect } from 'effect';
import { scriptedDecision } from './model.js';
import { personalAccount } from './personal-fixture.js';
it.live(
	'binds personal intake rules to their owner and refuses cross-user edits and oversized instructions',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const alice = yield* member(t, ['sales', 'crm'], { email: 'alice@example.test' });
			const bob = yield* member(t, ['sales', 'crm'], { email: 'bob@example.test' });
			const created = yield* (yield* t.as(alice)).act({
				'communication_settings.create': [
					{
						hard_filter: 'all',
						classification_sop: 'Prioritize deployment questions.'
					}
				]
			});
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const id = recordOf(created.records, 'communication_settings', 0).id;
			// the effect runs as alice, whose policy may start the replay it queues
			yield* t.run_due();
			for (const run of ['communication_settings.effect.create', 'replay_message_routes'])
				expect(yield* runRows(t, run)).toEqual([{ state: 'succeeded', error: null }]);
			expect(
				pageOf(
					yield* (yield* t.as(alice)).query({
						communication_settings: { where: { id: { eq: id } }, limit: 1 }
					}),
					'communication_settings'
				).rows[0] ?? null
			).toMatchObject({
				owner: alice.id
			});
			expect(
				pageOf(
					yield* (yield* t.as(bob)).query({ communication_settings: {} }),
					'communication_settings'
				).rows
			).toHaveLength(0);
			expect(
				yield* Effect.flip(
					(yield* t.as(bob)).act({
						'communication_settings.update': [
							{
								target: yield* targetOf(t, 'communication_settings', id),
								set: { hard_filter: 'customer_pics' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					(yield* t.as(alice)).act({
						'communication_settings.update': [
							{
								target: yield* targetOf(t, 'communication_settings', id),
								set: { classification_sop: 'x'.repeat(8001) }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
		}).pipe(Effect.scoped)
);
it.live(
	'filters native WhatsApp and email before AI and reads the syncing user’s supplementary SOP',
	() =>
		Effect.gen(function* () {
			const ai = scriptedDecision([]);
			const t = yield* workspace({ ports: ai.ports });
			const admin = yield* t.as(t.admin);
			const alice = yield* member(t, ['sales', 'crm'], { email: 'alice@example.test' });
			const bob = yield* member(t, ['sales', 'crm'], { email: 'bob@example.test' });
			const configured = yield* (yield* t.as(alice)).act({
				'communication_settings.create': [
					{
						hard_filter: 'all',
						classification_sop: 'Prioritize deployment questions.'
					}
				]
			});
			if (configured.kind !== 'committed') throw new Error(JSON.stringify(configured));
			const mailboxes = new Map([
				[alice, yield* personalAccount(t, alice, 'email')],
				[bob, yield* personalAccount(t, bob, 'email')]
			]);
			const emit = Effect.fnUntraced(function* emit(user: typeof alice, id: string) {
				yield* t.receive(required(mailboxes.get(user)), {
					id,
					sent_at: t.clock.now(),
					from: { address: 'unknown@example.test', name: null },
					to: [{ address: 'sales@example.test', name: null }],
					subject: id,
					text: 'Deployment question',
					headers: {}
				});
			});
			yield* emit(alice, 'alice:first');
			yield* emit(bob, 'bob:mail');
			yield* t.receive(yield* personalAccount(t, bob, 'whatsapp'), {
				id: 'bob:phone',
				thread: 'bob:phone',
				sent_at: t.clock.now(),
				from: { handle: '6599998888@s.whatsapp.net', name: null },
				text: 'Hello',
				attachments: []
			});
			yield* admin.run('sync_messages', {}, JobResult);
			yield* t.run_due();
			expect(ai.requests).toHaveLength(1);
			expect(ai.requests[0]).toMatchObject({
				state: { classification_sop: 'Prioritize deployment questions.' }
			});
			const bobItems = pageOf(
				yield* admin.query({
					activities: { where: { source_user: { eq: bob.id } } }
				}),
				'activities'
			);
			expect(bobItems.rows).toHaveLength(2);
			expect(
				bobItems.rows.every(
					(r) => r.classification === 'ignored' && String(r.reason ?? '').startsWith('Hard filter:')
				)
			).toBe(true);
		}).pipe(Effect.scoped)
);
