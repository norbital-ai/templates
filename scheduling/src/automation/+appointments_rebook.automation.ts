import { automation, type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { planRebooking } from '../lib/appointment-recovery.js';

export default automation({
	description:
		'Reassigns or reschedules an appointment to a feasible start and provider; recovery flows can bypass the customer change cutoff.',
	input: {
		targets: { kind: 'rows', of: 'appointments' },
		start: { kind: 'instant', optional: true },
		provider: { kind: 'ref', to: 'providers', optional: true }
	},
	policies: ['operations'],
	run: function* ({ start, provider, targets }, ctx) {
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const a of targets) {
			const plan = yield* planRebooking(
				a,
				{
					...(start == null ? {} : { start }),
					...(provider == null ? {} : { provider })
				},
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
