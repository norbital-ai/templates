import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';

export default defineQueryHandler({
	description:
		'Lists quotes as pipeline cards carrying the account name, status, gross and expiry date, optionally narrowed to one owner or one account.',
	schema: Schema.Struct({
		owner_id: Schema.optionalKey(Schema.String),
		account_id: Schema.optionalKey(Schema.String)
	}),
	handler: ({ owner_id, account_id }, api) =>
		Effect.gen(function* () {
			const where = {
				...(owner_id ? { owner_id: { eq: owner_id } } : {}),
				...(account_id ? { account_id: { eq: account_id } } : {})
			};

			const quotes = yield* api.db.query.quotes.findMany({
				where,
				columns: {
					id: true,
					account_id: true,
					doc_no: true,
					title: true,
					status: true,
					currency: true,
					gross: true,
					valid_until: true
				},
				orderBy: { doc_no: 'desc' },
				limit: 500
			});

			if (quotes.length === 0) {
				return { cards: [] };
			}

			const accountIds = [...new Set(quotes.map((quote) => quote.account_id))];
			const accounts = yield* api.db.query.accounts.findMany({
				where: { id: { in: accountIds } },
				columns: { id: true, name: true },
				limit: accountIds.length
			});
			const accountById = new Map(accounts.map((account) => [account.id, account.name]));

			return {
				cards: quotes.map((quote) => ({
					id: quote.id,
					doc_no: quote.doc_no,
					title: quote.title,
					account: accountById.get(quote.account_id) ?? 'Unknown account',
					status: quote.status,
					gross: quote.gross,
					currency: quote.currency,
					valid_until: quote.valid_until
				}))
			};
		})
});
