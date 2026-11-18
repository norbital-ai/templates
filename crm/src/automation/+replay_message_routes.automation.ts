import { automation } from '@norbital-ai/bolt';
import { retryRouting } from '../lib/activity-commands.js';

const REPLAY_PAGE = 50;

/**
 * A bounded pass after PIC/rule changes (queued by the contacts and communication_settings effects); ordinary sync does
 * not rescan unrelated account history.
 */
export default automation({
	description: 'Reconsiders captured history when customer PICs or connection filters change.',
	input: {
		owner: { kind: 'ref', to: 'sys_user', optional: true },
		thread: { kind: 'text', optional: true },
		after_seq: { kind: 'int', optional: true },
		started_at: { kind: 'instant', optional: true }
	},
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	run: function* ({ owner, thread, after_seq, started_at }, ctx) {
		const snapshot = started_at ?? ctx.now;
		const messages = (yield* ctx.query({
			activities: {
				where: {
					kind: { eq: 'message' },
					classification: { eq: 'ignored' },
					classified_by: { eq: 'hard_filter' },
					source_message: { is_null: false },
					source_seq: { gt: after_seq ?? 0 },
					created_at: { lte: snapshot },
					...(owner == null ? {} : { source_user: { eq: owner } }),
					...(thread == null ? {} : { thread_key: { eq: thread } })
				},
				fields: ['source_seq'],
				order_by: { source_seq: 'asc' },
				limit: REPLAY_PAGE
			}
		})).activities;
		for (const message of messages.rows) yield* retryRouting({ target: message.id }, ctx);
		if (messages.rows.length > 0)
			yield* ctx.schedule(
				'classify_messages',
				{},
				{ at: ctx.now, key: 'crm-message-classification-backlog' }
			);
		const last = messages.rows.at(-1)?.source_seq;
		if (messages.rows.length === REPLAY_PAGE && last != null)
			yield* ctx.schedule(
				'replay_message_routes',
				{
					...(owner == null ? {} : { owner }),
					...(thread == null ? {} : { thread }),
					after_seq: last,
					started_at: snapshot
				},
				{ at: ctx.now, key: `crm-routing-history-${owner ?? 'all'}-${thread ?? 'all'}-${last}` }
			);
	}
});
