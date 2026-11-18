import { automation } from '@norbital-ai/bolt';
import { reconsiderJobRules } from '../lib/activity-commands.js';

export default automation({
	description: 'Reconsiders captured messages when a job’s capture rules change.',
	input: {
		ids: { kind: 'ref', to: 'projects', many: true },
		after_seq: { kind: 'int', optional: true }
	},
	// queued by the projects effect when capture rules change, then by itself page by page
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const jobs = (yield* ctx.query({
			projects: { where: { id: { in: input.ids } }, fields: ['company_id'] }
		})).projects;
		const messages = (yield* ctx.query({
			activities: {
				where: {
					kind: { eq: 'message' },
					source_message: { is_null: false },
					source_seq: { gt: input.after_seq ?? 0 },
					or: [
						{ project_id: { in: jobs.rows.map((job) => job.id) } },
						{
							project_id: { is_null: true },
							company: { in: jobs.rows.flatMap((job) => (job.company_id ? [job.company_id] : [])) }
						}
					]
				},
				fields: ['project_id', 'company', 'source_seq'],
				order_by: { source_seq: 'asc' },
				limit: 50
			}
		})).activities;
		for (const message of messages.rows) {
			const job = jobs.rows.find((row) =>
				message.project_id ? row.id === message.project_id : row.company_id === message.company
			);
			if (job) yield* reconsiderJobRules({ target: message.id, project: job.id }, ctx);
		}
		const last = messages.rows.at(-1);
		if (messages.rows.length === 50 && last?.source_seq != null)
			yield* ctx.schedule('refresh_job_capture_rules', {
				ids: jobs.rows.map((job) => job.id),
				after_seq: last.source_seq
			});
	}
});
