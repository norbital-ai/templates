import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';

const DESK_TIME_ZONE = 'Asia/Singapore';

function deskToday(): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: DESK_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date());
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

export default defineAutomation(
	{ schedule: '0 6 * * *' },
	{
		/**
		 * The authority every run of this automation acts under.
		 *
		 * Its own, not its trigger's. This used to inherit whoever tripped it — so the same nightly
		 * sweep ran as an administrator when an administrator happened to start it, and as a contractor
		 * otherwise, over a different set of rows each time. Naming it here is what makes "what can this
		 * automation touch" a question with an answer that does not depend on the day.
		 *
		 * `sales_rep` alone, and not the pair a `Sales & Procurement` person holds: this sweep reads
		 * quotes and writes nothing a buyer owns, so naming the buy side too would widen it to cost and
		 * supplier data for no reason a reader could find in the handler.
		 */
		policies: ['sales_rep'],
		description:
			'Sweeps every morning for quotes still sitting at sent whose valid_until date has passed, and exports the lapsed ones for the desk to chase.',
		handler: (api) =>
			Effect.gen(function* () {
				const today = deskToday();

				const expiredQuotes = yield* api.db.query.quotes.findMany({
					where: {
						status: { eq: 'sent' },
						valid_until: { lte: today }
					},
					columns: {
						norbital_id: true,
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

				return {
					automation_key: 'quote_expiry_watch',
					generated_at: new Date().toISOString(),
					summary: { expired: expiredQuotes.length },
					exports: [
						{
							filename: 'expired-quotes.json',
							content_type: 'application/json',
							rows: expiredQuotes.slice(0, 50)
						}
					]
				};
			})
	}
);
