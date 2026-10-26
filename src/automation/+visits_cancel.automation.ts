import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateRow } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { observedOf } from '../lib/dispatch.js';
import { settingsOf, when } from '../lib/dispatch.js';
import { customerNotice } from '../lib/visit-recovery.js';
const HOUR = 3600000;

export default automation('visits_cancel', {
	description:
		'Cancels the visit; inside the free-change window before its start it is a late, chargeable cancellation.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 }
	},
	runAs: 'trigger',
	run: function* ({ targets }, ctx) {
		const { rows: targetsOf } = yield* ctx.query('visits', {
			where: { id: { in: targets } },
			all: true
		});
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateRow<'customer_notices'>[] = [];
		for (const v of targetsOf) {
			if (v.status !== 'scheduled')
				return yield* new Refusal({ message: 'Only a scheduled visit can be cancelled.' });
			const { free_change_hours } = yield* settingsOf(ctx);
			updates.push({
				target: v.id,
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
			yield* ctx.act.many([
				{ callable: 'visits.update', input: updates, observed: observedOf(targetsOf) },
				...(notices.length > 0
					? [{ callable: 'customer_notices.create' as const, input: notices }]
					: [])
			]);
	}
});
