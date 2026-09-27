import { automation } from '@norbital-ai/bolt';
import { iso } from '../lib/document-export.js';
import { numOrNull } from '../lib/pricing.js';

/**
 * Every morning, the sent quotes whose `valid_until` has passed (the first 50 of up to 250), on the run's result for
 * the desk to chase, with every lapsed quote in the run's `expired-quotes.json` attachment. Read-only: it never
 * changes a quote.
 */
const a = automation({
	description:
		'Sweeps every morning for quotes still sitting at sent whose valid_until date has passed, and exports the lapsed ones for the desk to chase.',
	on: { cron: '0 6 * * *' },
	runAs: ['quote_watch'],
	output: {
		kind: 'object',
		fields: {
			expired: { kind: 'int' },
			quotes: { kind: 'json' },
			attachment: { kind: 'file', accept: ['application/json'], max: '4MiB' }
		}
	}
});
export default a;

a.run(async (_, ctx) => {
	const lapsed = await ctx.read('quotes', {
		where: { status: { eq: 'sent' }, valid_until: { lte: { today: '' } } },
		select: {
			doc_no: true,
			title: true,
			account_id: true,
			owner_id: true,
			gross: true,
			currency: true,
			valid_until: true
		},
		limit: 250
	});
	const all = lapsed.rows.map((q) => ({
		...q,
		gross: numOrNull(q.gross),
		valid_until: iso(q.valid_until)
	}));
	const attachment = await ctx.files.put(new TextEncoder().encode(JSON.stringify(all)), {
		name: 'expired-quotes.json',
		mime: 'application/json',
		for: 'quote_expiry_watch'
	});
	return { expired: all.length, quotes: all.slice(0, 50), attachment };
});
