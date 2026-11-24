import { automation } from '@norbital-ai/bolt';
import { skipRacedWrite } from '../lib/message-import.js';

export default automation({
	description:
		'Resets review or previously ignored messages back to pending classification after contact directory or intake rule updates.',
	input: {
		owner: { kind: 'ref', to: 'sys_user', optional: true }
	},
	policies: ['construction_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const rows = (yield* ctx.query({
			project_messages: {
				where: {
					classification: { in: ['review', 'ignored'] },
					classified_by: { ne: 'manual' },
					...(input.owner != null ? { source_user: { eq: input.owner } } : {})
				},
				fields: ['revision'],
				order_by: { occurred_at: 'desc' },
				limit: 100
			}
		})).project_messages.rows;
		if (rows.length === 0) return;

		const first = rows[0];
		const last = rows[rows.length - 1];
		const key = `reclassify:${rows.length}:${first?.id ?? ''}:${first?.revision ?? 0}:${last?.id ?? ''}:${last?.revision ?? 0}`;
		yield* skipRacedWrite(
			ctx.act(
				{
					'project_messages.update': rows.map((row) => ({
						target: { id: row.id, revision: row.revision },
						set: {
							classification: 'pending' as const,
							classified_by: null,
							classified_at: null,
							reason: 'Queued for reclassification.'
						}
					}))
				},
				{ key }
			)
		);
		yield* ctx.schedule(
			'classify_messages',
			{},
			{ at: ctx.now, key: 'construction-classify-backlog' }
		);
	}
});
