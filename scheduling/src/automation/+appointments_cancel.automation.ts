import { automation, type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { DateTime } from 'effect';
import { settingsOf } from '../lib/dispatch.js';
import { formatInstant } from '../lib/format.js';
import { customerNotice } from '../lib/appointment-recovery.js';

export default automation({
	description:
		'Cancels one or more scheduled appointments; cancellations inside the free-change cutoff are marked late.',
	input: {
		targets: { kind: 'rows', of: 'appointments' }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const { free_change_hours } = yield* settingsOf(ctx);
		const cutoff = DateTime.add(DateTime.makeUnsafe(ctx.now), { hours: free_change_hours });
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const a of targets) {
			if (a.status !== 'scheduled') return yield* ctx.refuse('errors.cancel_not_scheduled');
			updates.push({
				target: a,
				set: {
					status: 'cancelled',
					attention: 'none',
					late_cancellation: DateTime.isLessThan(DateTime.makeUnsafe(a.slot.start), cutoff)
				}
			});
			const when = formatInstant(a.slot.start, ctx.tz);
			const notice = yield* customerNotice(
				ctx,
				a,
				`Appointment ${a.number} cancelled`,
				`Your appointment on ${when} has been cancelled.`
			);
			if (notice !== null) notices.push(notice);
		}
		if (updates.length > 0)
			yield* ctx.act({
				'appointments.update': updates,
				...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
			});
	}
});
