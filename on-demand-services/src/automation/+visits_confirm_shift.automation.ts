import { automation } from '@norbital-ai/bolt';
import { type ActInput } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { ownVisits, sameDay } from '../lib/visit-recovery.js';

export default automation('visits_confirm_shift', {
	description: 'The helper confirms they will work their visits that day.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 }
	},
	policies: ['helper_shift'],
	run: function* ({ targets }, ctx) {
		yield* ownVisits(ctx, targets);
		const { rows: targetsOf } = (yield* ctx.query({
			visits: { output: 'helper', where: { id: { in: targets } } }
		})).visits;
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const revisions = new Map<string, number>();
		for (const v of targetsOf) {
			const day = yield* sameDay(ctx, v);
			for (const row of day) revisions.set(row.id, row.revision);
			updates.push(
				...day.map((v) => ({ target: v.id, set: { shift_check: 'confirmed' as const } }))
			);
		}
		if (updates.length > 0)
			yield* ctx.act('visits.update', updates, { observed: Object.fromEntries(revisions) });
	}
});
