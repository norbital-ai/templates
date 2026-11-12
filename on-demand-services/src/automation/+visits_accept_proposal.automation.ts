import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { planRebooking } from '../lib/visit-recovery.js';

export default automation({
	description:
		'Approves a recommended replacement, rechecking availability and travel at approval.',
	input: {
		targets: { kind: 'rows', of: 'visits' }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const v of targets) {
			if (v.status !== 'scheduled' || v.proposed_helper === null || v.proposed_slot === null)
				return yield* ctx.refuse('errors.no_recommendation');
			const plan = yield* planRebooking(
				v,
				{ start: v.proposed_slot.start, helper: v.proposed_helper },
				ctx
			);
			updates.push(plan.update);
			if (plan.notice !== null) notices.push(plan.notice);
		}
		if (updates.length > 0)
			yield* ctx.act({
				'visits.update': updates,
				...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
			});
	}
});
