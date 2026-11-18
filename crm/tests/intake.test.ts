import { runAutomation } from '@norbital-ai/bolt-cli/test';
import { personalAccount } from './personal-fixture.js';
import { expect, it, layer } from '@effect/vitest';
import { member, recordAt, recordOf, sharedWorkspace, pageOf } from './workspace.js';
import { DateTime, Effect } from 'effect';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import { scriptedDecision } from './model.js';
import { sentMailHandle } from '../src/lib/conversations.js';

it('routes sent mail to its recipient and uses the workspace calendar date', () => {
	expect(sentMailHandle({ to: [{ address: 'customer@example.test' }] })).toBe(
		'customer@example.test'
	);
	expect(sentMailHandle(null)).toBe('');
	expect(
		DateTime.formatIsoDate(
			DateTime.makeZonedUnsafe('2026-10-01T18:00:00Z', { timeZone: 'Asia/Singapore' })
		)
	).toBe('2026-10-02');
});

// No System 1 answers: classification is unavailable.
// Every test owns its accounts, contacts and numbers, and reads only its own rows.
const ai = scriptedDecision([]);
layer(sharedWorkspace({ ports: ai.ports }), { excludeTestServices: true })('intake', (it) => {
	it.effect(
		'mirrors a late source message below the previously seen sequence and deduplicates reconnect delivery',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				yield* admin.act({
					'activities.create': [
						{
							kind: 'message',
							classification: 'pending',
							source_key: 'already-seen',
							external_id: 'high',
							source_seq: 100000,
							transport: 'whatsapp',
							subject: 'Previously synced',
							handle: 'unknown',
							detail: 'Earlier completed intake.',
							occurred_at: DateTime.formatIso(DateTime.makeUnsafe(t.clock.now()))
						}
					]
				});
				const account = yield* personalAccount(t, yield* member(t, ['sales', 'crm']), 'whatsapp');
				const message = {
					id: 'late',
					thread: 'customer',
					sent_at: t.clock.now(),
					from: { handle: '6581230001@s.whatsapp.net', name: 'Customer' },
					text: 'Late committed message.',
					attachments: []
				};
				const mirrored = () =>
					admin
						.query({ activities: { where: { source_key: { eq: account } } } })
						.pipe(Effect.map((answer) => pageOf(answer, 'activities').rows));
				yield* t.receive(account, message);
				yield* admin.run('sync_messages', {}, JobResult);
				yield* t.run_due();
				const rows = yield* mirrored();
				expect(rows).toHaveLength(1);
				expect(recordAt(rows, 0)['source_seq']).toBeLessThan(100000);
				expect(recordAt(rows, 0)['source_message']).toBe(recordAt(rows, 0)['external_id']);
				yield* t.receive(account, message);
				yield* admin.run('sync_messages', {}, JobResult);
				yield* t.run_due();
				expect(yield* mirrored()).toHaveLength(1);
			})
	);

	it.effect('refuses filing an item under a project of a different customer', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const customers = yield* admin.act({
				'companies.create': [{ name: 'First' }, { name: 'Second' }]
			});
			if (customers.kind !== 'committed') throw new Error(JSON.stringify(customers));
			const company = recordOf(customers.records, 'companies', 0).id;
			const other = recordOf(customers.records, 'companies', 1).id;
			const jobs = yield* admin.act({
				'projects.create': [{ name: 'Other project', company_id: other }]
			});
			if (jobs.kind !== 'committed') throw new Error(JSON.stringify(jobs));
			const project = recordOf(jobs.records, 'projects', 0).id;
			const created = yield* admin.act({
				'activities.create': [
					{
						kind: 'message',
						classification: 'pending',
						source_key: 'phone',
						external_id: 'review-me',
						source_seq: 1,
						transport: 'whatsapp',
						subject: 'Quote',
						handle: 'unknown',
						detail: 'Quote please.',
						occurred_at: '2026-10-01T18:00:00Z'
					}
				]
			});
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const target = recordOf(created.records, 'activities', 0).id;
			expect(
				yield* runAutomation(
					t,
					admin.run('activities_file', { activities: [target], company, project }, JobResult)
				)
			).toMatchObject({
				state: 'failed',
				error: { code: 'refused' }
			});
			expect(
				pageOf(yield* admin.query({ activities: { where: { id: { eq: target } } } }), 'activities')
					.rows
			).toMatchObject([{ project_id: null }]);
		})
	);
});
