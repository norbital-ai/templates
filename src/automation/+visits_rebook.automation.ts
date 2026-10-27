import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateRow } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { observedOf } from '../lib/dispatch.js';
import { planRebooking } from '../lib/visit-recovery.js';

export default automation('visits_rebook', {
	description:
		'Approves one occurrence at a feasible start; service recovery can bypass the customer change cutoff.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 },
		start: { kind: 'instant' },
		helper: { kind: 'id', of: 'helpers', optional: true }
	},
	runAs: 'trigger',
	run: function* ({ start, helper, targets }, ctx) {
		const { rows: targetsOf } = (yield* ctx.query({ visits: { where: { id: { in: targets } } } }))
			.visits;
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateRow<'customer_notices'>[] = [];
		for (const v of targetsOf) {
			const plan = yield* planRebooking(
				v,
				{ start, ...(helper === undefined ? {} : { helper }) },
				ctx
			);
			updates.push(plan.update);
			if (plan.notice !== null) notices.push(plan.notice);
		}
		if (updates.length > 0)
			yield* ctx.act.many([
				{ callable: 'visits.update', input: updates, observed: observedOf(targetsOf) },
				...(notices.length > 0
					? [{ callable: 'customer_notices.create' as const, input: notices }]
					: [])
			]);
	}
});
