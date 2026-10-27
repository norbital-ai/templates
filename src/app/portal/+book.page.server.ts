import { pageServer } from '@norbital-ai/bolt';
import data, { bookReads } from './book.page.data.js';

export default pageServer({
	data,
	load: function* (_request, ctx) {
		if (ctx.actor.kind !== 'member') return { customers: null, services: null, helpers: null };
		return yield* ctx.query(bookReads);
	}
});
