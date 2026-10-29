import { automation } from '@norbital-ai/bolt';
import rfis from '../data/model/rfis/+model.js';
import { DAILY_0600, digestOutput } from '../lib/digest.js';
const { project_id, related_defect_id, ...fields } = rfis.spec.fields;
export default automation('rfi_followup_watch', {
	description:
		'Sweeps the open RFIs every morning at 6am and publishes the first 25 by due date as a JSON extract so queries still waiting on the design team can be chased.',
	on: DAILY_0600,
	policies: ['construction_read'],
	output: digestOutput(fields),
	run: function* (_, ctx) {
		const {
			rfis: { rows }
		} = yield* ctx.query({
			rfis: {
				where: { status: { eq: 'open' } },
				orderBy: { due_date: 'asc' },
				limit: 25
			}
		});
		return { generated_at: ctx.now, count: rows.length, rows };
	}
});
