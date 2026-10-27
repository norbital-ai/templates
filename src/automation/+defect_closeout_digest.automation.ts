import { automation } from '@norbital-ai/bolt';
import defects from '../data/model/defects/+model.js';
import { DAILY_0600, digestOutput } from '../lib/digest.js';
const { project_id, site_location_id, job_id, ...fields } = defects.spec.fields;
export default automation('defect_closeout_digest', {
	description:
		'Counts the defect register every morning at 6am and publishes the first 25 open defects as a JSON extract for the closeout meeting.',
	on: DAILY_0600,
	runAs: ['construction_read'],
	output: digestOutput(fields),
	run: function* (_, ctx) {
		const {
			defects: { rows }
		} = yield* ctx.query({
			defects: {
				where: { status: { in: ['open', 'in_review', 'ready_for_closeout'] } },
				orderBy: { due_date: 'asc' },
				limit: 25
			}
		});
		return { generated_at: ctx.now, count: rows.length, rows };
	}
});
