import { automation, type Cursor } from '@norbital-ai/bolt';
import { workspaceChannels } from '../lib/conversations.js';
import { leadFollowUps, reminderFor, reminderMail, type Step } from '../lib/follow-ups.js';
import { DateTime } from 'effect';

/**
 * Every morning: each qualified lead without an open follow-up gets one, due its `follow_up_days` after it was last
 * touched; then each open follow-up owed a reminder gets it — in the owner's inbox and, through the workspace's own
 * WhatsApp, Telegram, Slack, Discord or email account (where the envoy answers), as a direct message to their handle
 * there — and an escalation also reaches whoever raised it. The step is recorded, so a rerun sends nothing twice.
 */
export default automation({
	description:
		'Plans each qualified lead’s next follow-up on its cadence, and reminds follow-up owners by direct message the day before, on the due day and when overdue, escalating after three days.',
	on: [{ cron: '0 9 * * *' }],
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		// qualified leads: the next follow-up on their cadence, unless one is already open
		const leads = (yield* ctx.query({
			companies: {
				where: { stage: { eq: 'qualified' } },
				fields: ['name', 'owner', 'follow_up_days']
			}
		})).companies.rows;
		const ids = leads.map((lead) => lead.id);
		// two aggregates of one model: two reads (a read request names a model once)
		const touched = (yield* ctx.query({
			activities: {
				where: { company: { in: ids } },
				aggregate: { by: 'company', max: ['occurred_at'] }
			}
		})).activities.rows;
		const open = (yield* ctx.query({
			tasks: {
				where: { company: { in: ids }, kind: { eq: 'follow_up' }, status: { eq: 'open' } },
				aggregate: { by: 'company' }
			}
		})).tasks.rows;
		const planned = leadFollowUps(
			leads,
			new Map(touched.map((row) => [row.key.company, row.max?.occurred_at ?? null])),
			new Set(open.map((row) => row.key.company)),
			ctx.today,
			ctx.tz
		);
		if (planned.length > 0) yield* ctx.act({ 'tasks.create': planned });

		const tomorrow = DateTime.formatIsoDate(
			DateTime.add(DateTime.makeUnsafe(ctx.today), { days: 1 })
		);
		const via = yield* workspaceChannels(ctx);
		let after: Cursor | undefined;
		let total = 0;
		do {
			const page = (yield* ctx.query({
				tasks: {
					where: {
						status: { eq: 'open' },
						due_on: { lte: tomorrow },
						reminder: { ne: 'escalated' }
					},
					fields: ['subject', 'due_on', 'reminder', 'created_by', 'owner', 'revision'],
					limit: 500,
					...(after === undefined ? {} : { after }),
					company: { fields: ['name'] }
				}
			})).tasks;
			const owed = page.rows.flatMap((f) => {
				if (f.due_on == null) return [];
				const step = reminderFor(f.due_on, ctx.today, f.reminder);
				return step === null ? [] : [{ f, due_on: f.due_on, step }];
			});
			for (const { f, due_on, step } of owed) {
				const mail = reminderMail(step, {
					title: f.subject,
					due_on,
					about: f.company?.name ?? null
				});
				const readers = [f.owner, step === 'escalated' ? f.created_by : null].filter(
					(id): id is NonNullable<typeof id> => id != null
				);
				if (readers.length > 0)
					yield* ctx.notify({
						to: [...new Set(readers)].map((user) => ({ user })),
						via,
						title: mail.subject,
						description: mail.text,
						link: { model: 'tasks', id: f.id },
						once: `${f.id}:${step}:${due_on}`
					});
			}
			if (owed.length > 0)
				yield* ctx.act({
					'tasks.update': owed.map(({ f, step }) => ({
						target: { id: f.id, revision: f.revision },
						set: { reminder: step satisfies Step, reminded_at: ctx.now }
					}))
				});
			total += owed.length;
			after = page.next ?? undefined;
		} while (after !== undefined);
		yield* ctx.progress({ text: `${planned.length} lead follow-ups planned, ${total} reminders` });
	}
});
