import { expect, it } from '@effect/vitest';
import { Context, Effect, Schema } from 'effect';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import {
	workspaceServices,
	member,
	recordAt,
	recordOf,
	nativeId,
	pageOf,
	targetOf,
	connectedAccount
} from './workspace.js';

it.live('reaches owed reminders after a page of already-reminded follow-ups', () =>
	Effect.gen(function* () {
		const services = yield* workspaceServices({ now: '2026-10-01T01:00:00Z' });
		const t = Context.get(services, TestWorkspace);
		const owner = yield* member(t, [], { email: 'owner@example.test', admin: true });
		const admin = yield* t.as(t.admin);
		const created = yield* admin.act({
			'tasks.create': Array.from({ length: 501 }, (_, i) => ({
				kind: 'follow_up' as const,
				subject: `Reminder ${i}`,
				due_on: '2026-10-02',
				owner: owner.id
			}))
		});
		if (created.kind !== 'committed') throw new Error('Missing follow-ups');
		const owed = nativeId(
			'tasks',
			recordAt(
				[...created.records.filter((record) => record.model === 'tasks')].sort((a, b) =>
					b.id.localeCompare(a.id)
				)
			).id
		);
		expect(
			(yield* admin.act({
				'tasks.update': created.records
					.filter((r) => r.model === 'tasks')
					.map((r) => ({
						target: { id: nativeId('tasks', r.id), revision: r.revision },
						set: { reminder: 'before' as const }
					}))
			})).kind
		).toBe('committed');
		// the workspace channel reminders reach members through (no owner: no member's personal account)
		const mail = yield* connectedAccount(t, 'email', 'Client mailbox');
		const renamed = yield* admin.act({
			'tasks.update': [
				{
					target: yield* targetOf(t, 'tasks', owed),
					set: { subject: 'Final row', reminder: 'none' }
				}
			]
		});
		yield* admin.run('remind_follow_ups', {}, JobResult);
		yield* t.run_due();
		const sent = t.fakes.links.sent.filter((message) => message.instance === mail);
		expect(sent).toHaveLength(1);
		expect(
			Schema.decodeUnknownSync(
				Schema.Struct({ subject: Schema.String, to: Schema.Array(Schema.String) })
			)(recordAt(sent).message)
		).toMatchObject({ subject: 'Due tomorrow: Final row', to: ['owner@example.test'] });
		// only the owed row past the first page moved: the 500 already reminded stay as they were
		const reminded = pageOf(
			yield* admin.query({
				tasks: { where: { reminded_at: { is_null: false } }, fields: ['reminder'], limit: 10 }
			}),
			'tasks'
		).rows;
		expect(reminded.map((row) => row.id)).toEqual([owed]);
		expect(
			pageOf(yield* admin.query({ tasks: { where: { id: { eq: owed } }, limit: 1 } }), 'tasks')
				.rows[0] ?? null
		).toMatchObject({
			reminder: 'before',
			reminded_at: '2026-10-01T01:00:00.000Z'
		});
	}).pipe(Effect.scoped)
);
