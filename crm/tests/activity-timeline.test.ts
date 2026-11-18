import { expect, it } from '@effect/vitest';
import {
	workspace,
	member,
	recordAt,
	required,
	recordOf,
	pageOf,
	nativeId,
	idOf,
	ofKind
} from './workspace.js';
import { DateTime, Effect, Schema } from 'effect';
import { activitySlices } from '../src/lib/activity-timeline.js';

/** The fields a conversation slice reads, decoded from the kit's manifest-typed rows. */
const TimelineRows = Schema.Array(
	Schema.Struct({
		id: idOf('activities'),
		kind: ofKind({
			kind: 'enum',
			values: ['note', 'recording', 'call', 'message', 'meeting', 'milestone']
		}),
		subject: Schema.String,
		occurred_at: ofKind({ kind: 'instant' }),
		source_key: Schema.NullOr(Schema.String),
		thread_key: Schema.NullOr(Schema.String),
		project_id: Schema.NullOr(Schema.String)
	})
);
it.live('keeps the conversation chronological while follow-ups use native task completion', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const companyResult = yield* admin.act({ 'companies.create': [{ name: 'Timeline customer' }] });
		if (companyResult.kind !== 'committed') throw new Error(JSON.stringify(companyResult));
		const company = recordOf(companyResult.records, 'companies').id;
		expect(
			(yield* admin.act({
				'activities.create': [
					{ kind: 'meeting', subject: 'Demo', company, occurred_at: '2026-10-02T10:00:00Z' },
					{
						kind: 'message',
						subject: 'Email enquiry',
						company,
						occurred_at: '2026-10-02T08:00:00Z',
						transport: 'email',
						detail: 'Can we arrange a demo?'
					},
					{ kind: 'note', subject: 'Requirements', company, occurred_at: '2026-10-02T09:00:00Z' }
				]
			})).kind
		).toBe('committed');
		const task = yield* admin.act({
			'tasks.create': [
				{ kind: 'follow_up', subject: 'Send proposal', company, due_on: '2026-10-03' }
			]
		});
		if (task.kind !== 'committed') throw new Error(JSON.stringify(task));
		const target = recordOf(task.records, 'tasks');
		expect(
			(yield* admin.act({
				'tasks.update': [
					{ target: { id: target.id, revision: target.revision }, set: { status: 'done' } }
				]
			})).kind
		).toBe('committed');
		expect(
			pageOf(
				yield* admin.query({
					activities: { where: { company: { eq: company } }, order_by: { occurred_at: 'desc' } }
				}),
				'activities'
			).rows.map((r) => r['subject'])
		).toEqual(['Demo', 'Requirements', 'Email enquiry']);
		expect(
			pageOf(yield* admin.query({ tasks: { where: { id: { eq: target.id } } } }), 'tasks').rows[0]
		).toMatchObject({ subject: 'Send proposal', status: 'done', company });
	}).pipe(Effect.scoped)
);
it.live(
	'keeps project conversation slices chronological across history batches and separates users and long gaps',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const admin = yield* t.as(t.admin);
			const users = [yield* member(t, ['sales', 'crm']), yield* member(t, ['sales', 'crm'])];
			const company = yield* admin.act({ 'companies.create': [{ name: 'Slice fixture' }] });
			if (company.kind !== 'committed') throw new Error('Missing company');
			const projects = yield* admin.act({
				'projects.create': [
					{ name: 'First', company_id: recordOf(company.records, 'companies').id },
					{ name: 'Second', company_id: recordOf(company.records, 'companies').id }
				]
			});
			if (projects.kind !== 'committed') throw new Error('Missing projects');
			const created = yield* admin.act({
				'activities.create': [
					{
						subject: 'b',
						occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-02T10:10:00Z'))
					},
					{
						subject: 'a',
						occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-02T10:00:00Z'))
					},
					{
						subject: 'c',
						occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-02T10:20:00Z'))
					},
					{
						subject: 'd',
						occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-02T11:00:00Z'))
					},
					{
						subject: 'e',
						occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-02T10:15:00Z')),
						source_user: recordAt(users, 1).id
					},
					{
						subject: 'f',
						occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-02T10:16:00Z')),
						project_id: recordOf(projects.records, 'projects', 1).id
					}
				].map((row) => ({
					kind: 'message' as const,
					source_key: 'phone',
					source_user: recordAt(users).id,
					thread_key: 'group',
					project_id: recordOf(projects.records, 'projects').id,
					...row
				}))
			});
			if (created.kind !== 'committed') throw new Error('Missing messages');
			const rows = (yield* Schema.decodeUnknownEffect(TimelineRows)(
				pageOf(
					yield* admin.query({
						activities: {
							where: {
								id: {
									in: created.records
										.filter((record) => record.model === 'activities')
										.map((record) => nativeId('activities', record.id))
								}
							}
						}
					}),
					'activities'
				).rows
			)).map((row) => ({
				...row,
				source_user: recordAt(users, row.subject === 'e' ? 1 : 0).id
			}));
			const id = (subject: string) => required(rows.find((row) => row.subject === subject)).id;
			const slices = activitySlices([...rows, recordAt(rows, 0)]);
			expect(slices).toHaveLength(5);
			expect(slices[0]?.messages.map((row) => row.id)).toEqual([id('d')]);
			expect(slices.find((slice) => slice.id === id('c'))?.messages.map((row) => row.id)).toEqual([
				id('c')
			]);
			expect(slices.find((slice) => slice.id === id('a'))?.messages.map((row) => row.id)).toEqual([
				id('a'),
				id('b')
			]);
		}).pipe(Effect.scoped)
);
