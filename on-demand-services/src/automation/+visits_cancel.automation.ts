import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { settingsOf, when } from '../lib/dispatch.js';
import { customerNotice } from '../lib/visit-recovery.js';
const HOUR = 3600000;

export default automation({
	description:
		'Cancels the visit; inside the free-change window before its start it is a late, chargeable cancellation.',
	input: {
		targets: { kind: 'rows', of: 'visits' }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const v of targets) {
			if (v.status !== 'scheduled') return yield* ctx.refuse('errors.cancel_not_scheduled');
			const { free_change_hours } = yield* settingsOf(ctx);
			updates.push({
				target: v,
				set: {
					status: 'cancelled',
					attention: 'none',
					late_cancellation:
						Date.parse(v.slot.start) - Date.parse(ctx.now) < free_change_hours * HOUR
				}
			});
			const notice = yield* customerNotice(
				ctx,
				v,
				`Visit ${v.number} cancelled`,
				`Your visit on ${when(v.slot.start, ctx.tz)} is cancelled.`
			);
			if (notice !== null) notices.push(notice);
		}
		if (updates.length > 0)
			yield* ctx.act({
				'visits.update': updates,
				...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
			});
	}
});
