import { automation } from '@norbital-ai/bolt';
import { retryRouting } from '../lib/activity-commands.js';
import { skipRacedWrite } from '../lib/message-import.js';

const REPLAY_PAGE = 50;
const CHANNELS = ['email', 'whatsapp', 'telegram', 'slack', 'discord'] as const;

/**
 * A bounded pass after PIC or connection classifier changes (queued by the contacts effects or triggered on
 * sys_integration updates); ordinary sync does not rescan unrelated account history.
 */
export default automation({
	description:
		'Reconsiders captured history when customer PICs or connection classifier settings change.',
	on: [{ model: 'sys_integration', verbs: ['update'] }],
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
		if (
			ctx.trigger?.kind === 'system' &&
			ctx.trigger.cause === 'event' &&
			ctx.trigger.model === 'sys_integration' &&
			ctx.trigger.records.length > 0
		) {
			const changed = (yield* ctx.query({
				sys_integration: {
					where: {
						id: { in: [...ctx.trigger.records] },
						integration: { in: [...CHANNELS] }
					},
					fields: ['integration'],
					limit: ctx.trigger.records.length
				}
			})).sys_integration.rows;
			if (changed.length === 0) return;
			const rows = (yield* ctx.query({
				activities: {
					where: {
						kind: { eq: 'message' },
						classification: { in: ['ignored', 'review'] },
						classified_by: { ne: 'manual' },
						source_message: { is_null: false },
						source_key: { in: changed.map((c) => c.id) },
						source_seq: { gt: after_seq ?? 0 },
						created_at: { lte: snapshot }
					},
					fields: ['revision', 'source_seq'],
					order_by: { source_seq: 'asc' },
					limit: REPLAY_PAGE
				}
			})).activities.rows;
			if (rows.length > 0) {
				yield* skipRacedWrite(
					ctx.act({
						'activities.update': rows.map((row) => ({
							target: { id: row.id, revision: row.revision },
							set: {
								classification: 'pending' as const,
								classified_by: null,
								classified_at: null,
								reason: 'Connection classifier changed. Automatic classification will retry.'
							}
						}))
					})
				);
				yield* ctx.schedule(
					'classify_messages',
					{},
					{ at: ctx.now, key: 'crm-message-classification-backlog' }
				);
			}
			return;
		}
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
