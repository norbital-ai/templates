import { automation, type Cursor } from '@norbital-ai/bolt';

/** Queue small projections when a client is added after the calendar was imported (queued by the contacts effect). */
export default automation({
	description: 'Matches already imported calendar appointments after client contacts change.',
	policies: ['calendar_activities'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		let after: Cursor | undefined;
		do {
			const entries = (yield* ctx.query({
				calendar_entries: {
					where: { created_at: { lte: ctx.now } },
					fields: ['id'],
					limit: 50,
					...(after === undefined ? {} : { after })
				}
			})).calendar_entries;
			if (entries.rows.length > 0)
				yield* ctx.schedule(
					'sync_calendar_activities',
					{ ids: entries.rows.map((entry) => entry.id) },
					{ at: ctx.now }
				);
			after = entries.next ?? undefined;
		} while (after !== undefined);
	}
});
