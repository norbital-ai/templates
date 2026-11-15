import { automation } from '@norbital-ai/bolt';

/** Unlocks a month: its report follows live data again until it is locked again. */
export default automation({
	description: 'Unlock a month-end so it follows live data until locked again.',
	input: { report: { kind: 'rows', of: 'month_end' } },
	policies: ['treasury'],
	run: function* ({ report }, ctx) {
		yield* ctx.act({
			'month_end.update': report.map((target) => ({ target, set: { is_locked: false } }))
		});
	}
});
