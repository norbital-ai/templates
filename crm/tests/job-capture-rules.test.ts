import { JobResult } from '@norbital-ai/bolt-cli/test';
import { runAutomation } from '@norbital-ai/bolt-cli/test';
import { expect, it } from '@effect/vitest';
import { workspace, member, required, recordOf, pageOf, targetOf, nativeId } from './workspace.js';
import { Effect, Schema } from 'effect';
import { personalAccount } from './personal-fixture.js';
it.live('reconsiders captured job messages after rule edits but preserves manual filing', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const customer = yield* admin.act({ 'companies.create': [{ name: 'Example' }] });
		if (customer.kind !== 'committed') throw new Error(JSON.stringify(customer));
		const company = recordOf(customer.records, 'companies', 0).id;
		const job = yield* admin.act({
			'projects.create': [{ name: 'Delivery', company_id: company }]
		});
		if (job.kind !== 'committed') throw new Error(JSON.stringify(job));
		const project = recordOf(job.records, 'projects', 0).id;
		yield* admin.act({
			'contacts.create': [
				{
					full_name: 'Example contact',
					phone: '+65 8123 4506',
					company_id: company
				}
			]
		});
		const phone = yield* personalAccount(t, yield* member(t, ['sales', 'crm']), 'whatsapp');
		for (const id of ['automatic', 'manual'])
			yield* t.receive(phone, {
				id,
				thread: id,
				sent_at: t.clock.now(),
				from: { handle: '6581234506@s.whatsapp.net', name: 'Example' },
				text: 'Delivery update',
				attachments: []
			});
		// captured messages: activities naming their stored source messages
		const sources = pageOf(
			yield* admin.query({
				sys_message: {
					where: { integration: { eq: phone } },
					fields: ['seq'],
					order_by: { seq: 'asc' }
				}
			}),
			'sys_message'
		).rows;
		const captured = yield* admin.act({
			'activities.create': sources.map((source) => ({
				kind: 'message' as const,
				classification: 'pending' as const,
				subject: 'Example',
				detail: 'Delivery update',
				transport: 'whatsapp' as const,
				handle: '6581234506@s.whatsapp.net',
				source_message: nativeId('sys_message', source.id),
				source_seq: Schema.decodeUnknownSync(Schema.Number)(source['seq'])
			}))
		});
		if (captured.kind !== 'committed') throw new Error(JSON.stringify(captured));
		const firstId = recordOf(captured.records, 'activities', 0).id;
		const secondId = recordOf(captured.records, 'activities', 1).id;
		yield* admin.act({
			'activities.update': [
				{
					target: yield* targetOf(t, 'activities', firstId),
					set: {
						project_id: project,
						classification: 'useful',
						classified_by: 'model',
						reason: 'System 1 classified useful customer activity.'
					}
				}
			]
		});
		yield* runAutomation(
			t,
			admin.run('activities_file', { activities: [secondId], company, project }, JobResult)
		);
		const before = yield* targetOf(t, 'activities', firstId);
		yield* admin.act({
			'projects.update': [
				{
					target: yield* targetOf(t, 'projects', project),
					set: { capture_rules: 'Only capture delivery confirmations.' }
				}
			]
		});
		yield* t.run_due();
		// the row as its next revision left it: that revision's instant, then the row as of it
		const next = before.revision + 1;
		const revisions = yield* admin.history('activities', firstId, { at: { revision: next } });
		const at = required(revisions.find((entry) => entry.revision === next)).at;
		expect(
			pageOf(
				yield* admin.query({ activities: { where: { id: { eq: firstId } }, as_of: at, limit: 1 } }),
				'activities'
			).rows[0]
		).toMatchObject({
			classification: 'pending',
			classified_by: null,
			classified_at: null,
			reason: 'Job capture rules changed. Automatic classification will retry.'
		});
		expect(
			pageOf(
				yield* admin.query({ activities: { where: { id: { eq: firstId } }, limit: 1 } }),
				'activities'
			).rows[0] ?? null
		).toMatchObject({
			classification: 'pending'
		});
		expect(
			pageOf(
				yield* admin.query({ activities: { where: { id: { eq: secondId } }, limit: 1 } }),
				'activities'
			).rows[0] ?? null
		).toMatchObject({
			classification: 'useful',
			classified_by: 'manual',
			project_id: project,
			reason: 'Customer assignment changed manually.'
		});
	}).pipe(Effect.scoped)
);
