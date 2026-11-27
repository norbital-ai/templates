import { automation } from '@norbital-ai/bolt';
import { fileMessages, requeueMessages } from '../data/model/project_messages/intake.js';

export default automation({
	description:
		'Classifies and files pending WhatsApp/email project messages using each connection’s classifier settings and 30-message conversation window, and replays previously routed messages when a connection’s classifier changes.',
	on: [{ model: 'sys_integration', verbs: ['update'] }],
	input: {
		ids: { kind: 'ref', to: 'project_messages', many: true, optional: true }
	},
	policies: ['construction_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
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
						integration: { in: ['whatsapp', 'email'] }
					},
					fields: ['integration'],
					limit: ctx.trigger.records.length
				}
			})).sys_integration.rows;
			if (changed.length > 0) {
				yield* requeueMessages({ source_key: { in: changed.map((c) => c.id) } }, ctx);
			}
		}
		if (input.ids != null && input.ids.length > 0) {
			yield* fileMessages(input.ids, ctx);
		}
	}
});
