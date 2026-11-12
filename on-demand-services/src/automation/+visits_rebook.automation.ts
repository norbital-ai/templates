import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { planRebooking } from '../lib/visit-recovery.js';

export default automation({
	description:
		'Approves one occurrence at a feasible start; service recovery can bypass the customer change cutoff.',
	input: {
		targets: { kind: 'rows', of: 'visits' },
		start: { kind: 'instant' },
		helper: { kind: 'ref', to: 'helpers', optional: true }
	},
	policies: ['operations'],
	run: function* ({ start, helper, targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const v of targets) {
			const plan = yield* planRebooking(
				v,
				{ start, ...(helper === undefined ? {} : { helper }) },
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
