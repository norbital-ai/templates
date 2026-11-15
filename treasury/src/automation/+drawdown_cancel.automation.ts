import { automation } from '@norbital-ai/bolt';

/** Finance or Treasury cancels an earmark that will not be drawn: the room is free again. */
export default automation({
	description: 'Cancel an earmark; its room on the bank line is free again.',
	input: { earmark: { kind: 'rows', of: 'drawdown' } },
	policies: ['finance'],
	run: function* ({ earmark }, ctx) {
		const row = earmark.findIndex((d) => d.status !== 'earmarked');
		if (row >= 0) return yield* ctx.refuse('errors.not_earmark', { row });
		yield* ctx.act({
			'drawdown.update': earmark.map((target) => ({
				target,
				set: { status: 'cancelled' as const }
			}))
		});
	}
});
