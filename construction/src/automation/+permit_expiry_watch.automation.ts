import { automation } from '@norbital-ai/bolt';
import permits_to_work from '../data/model/permits_to_work/+model.js';
import { DAILY_0600, digestOutput } from '../lib/digest.js';
const { project_id, site_location_id, job_id, worker_id, ...fields } = permits_to_work.spec.fields;
export default automation('permit_expiry_watch', {
	description:
		'Sweeps the active and expiring permits to work every morning at 6am and publishes the first 25 as a JSON extract so permits nearing the end of their validity range are caught before crews are stood down.',
	on: DAILY_0600,
	policies: ['construction_read'],
	output: digestOutput(fields),
	run: function* (_, ctx) {
		const {
			permits_to_work: { rows }
		} = yield* ctx.query({
			permits_to_work: {
				where: { status: { in: ['active', 'expiring_soon'] } },
				orderBy: { requested_date: 'asc' },
				limit: 25
			}
		});
		return { generated_at: ctx.now, count: rows.length, rows };
	}
});
