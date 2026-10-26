import { pageServer } from '@norbital-ai/bolt';
import data, { visitsReads } from './visits.page.data.js';

export default pageServer({
	data,
	load: function* (_request, ctx) {
		if (ctx.actor.kind !== 'member') return { visits: null, notices: null };
		return yield* ctx.query(visitsReads);
	}
});
