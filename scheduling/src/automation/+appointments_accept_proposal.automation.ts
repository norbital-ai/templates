import { automation, type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { planRebooking } from '../lib/appointment-recovery.js';

export default automation({
	description:
		'Approves a recommended replacement provider after rechecking live availability and travel.',
	input: {
		targets: { kind: 'rows', of: 'appointments' }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const a of targets) {
			if (a.status !== 'scheduled' || a.proposed_provider === null || a.proposed_slot === null)
				return yield* ctx.refuse('errors.no_recommendation');
			const plan = yield* planRebooking(
				a,
				{ start: a.proposed_slot.start, provider: a.proposed_provider },
				ctx
			);
			updates.push(plan.update);
			if (plan.notice !== null) notices.push(plan.notice);
		}
		if (updates.length > 0)
			yield* ctx.act({
				'appointments.update': updates,
				...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
			});
	}
});
