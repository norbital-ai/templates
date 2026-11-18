/**
 * Reminders: which step is owed when; the morning run that notifies each owner once per step — in the inbox and by direct
 * message through the workspace's channels — and escalates; and each qualified lead's next follow-up on its cadence.
 */
import { expect, it } from '@effect/vitest';
import { describe } from 'vitest';
import { workspace, member, pageOf, connectedAccount, idOf } from './workspace.js';
import { Effect, Schema } from 'effect';
import { leadFollowUps, reminderFor } from '../src/lib/follow-ups.js';
describe('reminderFor', () => {
	it.each([
		['2026-10-05', '2026-10-01', 'none', null],
		['2026-10-02', '2026-10-01', 'none', 'before'],
		['2026-10-02', '2026-10-01', 'before', null],
		['2026-10-01', '2026-10-01', 'before', 'due'],
		['2026-10-01', '2026-10-01', 'none', 'due'],
		['2026-10-01', '2026-10-02', 'due', 'overdue'],
		['2026-10-01', '2026-10-03', 'overdue', null],
		['2026-10-01', '2026-10-04', 'overdue', 'escalated'],
		['2026-10-01', '2026-10-09', 'none', 'escalated'],
		['2026-10-01', '2026-10-09', 'escalated', null]
	] satisfies readonly [
		string,
		string,
		Parameters<typeof reminderFor>[2],
		ReturnType<typeof reminderFor>
	][])('due %s, today %s, last %s → %s', (due, today, sent, owed) => {
		expect(reminderFor(due, today, sent)).toBe(owed);
	});
});
it.live(
	'the morning run notifies the owner once per step through the workspace channel, and escalates to whoever raised it',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({
				now: '2026-10-01T00:30:00Z'
			});
			const lead = yield* member(t, [], { email: 'lead@norbital.test', admin: true });
			const owner = yield* member(t, [], { email: 'owner@norbital.test', admin: true });
			// the workspace's own account: a notice via it reaches each recipient's handle there
			const mail = yield* connectedAccount(t, 'email', 'Client mailbox');
			const as = yield* t.as(lead);
			const created = yield* as.act({
				'tasks.create': [
					{
						kind: 'follow_up',
						subject: 'Chase the signed NDA',
						due_on: '2026-10-02',
						owner: owner.id
					},
					{
						kind: 'follow_up',
						subject: 'Send the UAT plan',
						due_on: '2026-09-27',
						owner: owner.id
					},
					{ kind: 'follow_up', subject: 'Nothing yet', due_on: '2026-10-20', owner: owner.id }
				]
			});
			expect(created.kind).toBe('committed');
			const mailed = () =>
				t.fakes.links.sent
					.filter((sent) => sent.instance === mail)
					.map((s) => {
						const m = Schema.decodeUnknownSync(
							Schema.Struct({ to: Schema.Array(Schema.String), subject: Schema.String })
						)(s.message);
						return [m.subject, [...m.to].sort()];
					});
			t.clock.set('2026-10-01T01:00:30Z'); // 09:00 in Singapore
			yield* t.run_due(); // the queued direct messages go out
			expect(mailed()).toEqual(
				expect.arrayContaining([
					['Due tomorrow: Chase the signed NDA', ['owner@norbital.test']],
					['Overdue — escalated: Send the UAT plan', ['owner@norbital.test']],
					['Overdue — escalated: Send the UAT plan', ['lead@norbital.test']]
				])
			);
			expect(mailed()).toHaveLength(3);
			const { rows } = pageOf(yield* as.query({ tasks: { order_by: { due_on: 'asc' } } }), 'tasks');
			expect(rows.map((r) => [r['subject'], r['reminder']])).toEqual([
				['Send the UAT plan', 'escalated'],
				['Chase the signed NDA', 'before'],
				['Nothing yet', 'none']
			]);
			const notices = pageOf(
				yield* (yield* t.as(owner)).query({ sys_notification: {} }),
				'sys_notification'
			);
			expect(notices.rows.length).toBeGreaterThanOrEqual(2);
			// the next morning: the NDA is due today, the escalation is not repeated
			t.clock.set('2026-10-02T01:00:30Z');
			yield* t.run_due();
			expect(mailed().slice(3)).toEqual([
				['Due today: Chase the signed NDA', ['owner@norbital.test']]
			]);
		}).pipe(Effect.scoped)
);

describe('leadFollowUps', () => {
	const company = Schema.decodeUnknownSync(idOf('companies'));
	const a = company('0b000000-0000-4000-8000-00000000000a'),
		b = company('0b000000-0000-4000-8000-00000000000b'),
		c = company('0b000000-0000-4000-8000-00000000000c');
	const leads = [
		{ id: a, name: 'Touched', owner: null, follow_up_days: 7 },
		{ id: b, name: 'Open', owner: null, follow_up_days: 7 },
		{ id: c, name: 'Stale', owner: null, follow_up_days: 3 }
	];
	it('plans the next follow-up on each cadence, never beside an open one, never in the past', () => {
		const planned = leadFollowUps(
			leads,
			new Map([
				[a, '2026-09-30T20:00:00Z'], // 1 October in Singapore
				[c, '2026-09-01T00:00:00Z']
			]),
			new Set([b]),
			'2026-10-02',
			'Asia/Singapore'
		);
		expect(planned.map((f) => [f.subject, f.due_on, f.company])).toEqual([
			['Follow up Touched', '2026-10-08', a],
			['Follow up Stale', '2026-10-02', c]
		]);
	});
});
