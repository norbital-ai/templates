import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { planRebooking } from '../lib/visit-recovery.js';

export default automation({
	description:
		'Approves a recommended replacement, rechecking availability and travel at approval.',
	input: {
		targets: { kind: 'ref', to: 'visits', many: true, min_items: 1 }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const { rows: targetsOf } = (yield* ctx.query({ visits: { where: { id: { in: targets } } } }))
			.visits;
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const v of targetsOf) {
			if (v.status !== 'scheduled' || v.proposed_helper === null || v.proposed_slot === null)
				return yield* new Refusal({
					message: 'This scheduled visit has no recommendation to approve.'
				});
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
