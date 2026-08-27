import { Effect } from 'effect';
import type { Hooks } from './$types.js';

const COMMITTED_TARGETS = {
	quotes: 'confirmed',
	purchase_orders: 'confirmed',
	purchase_invoices: 'confirmed'
} as const;

type TargetType = keyof typeof COMMITTED_TARGETS;

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Records a payment only against a confirmed quote, purchase order or purchase invoice, for a positive amount in the currency of that document.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						const regardingType = input.regarding_type;
						if (!regardingType || !(regardingType in COMMITTED_TARGETS)) {
							return yield* Effect.fail(
								new Error(
									'A settlement must reference a quote, purchase order, or purchase invoice.'
								)
							);
						}
						if (!input.regarding_id) {
							return yield* Effect.fail(new Error('A settlement must reference a document.'));
						}

						const amount = Number(input.amount);
						if (Number.isNaN(amount) || amount <= 0) {
							return yield* Effect.fail(new Error('Settlement amount must be greater than zero.'));
						}

						if (regardingType === 'quotes') {
							const quote = yield* api.db.quotes.findFirst({
								where: { id: { eq: input.regarding_id } }
							});
							if (!quote) {
								return yield* Effect.fail(new Error('Referenced quote does not exist.'));
							}
							if (quote.status !== 'confirmed') {
								return yield* Effect.fail(
									new Error('Settlements can only be recorded against a confirmed quote.')
								);
							}
							if (input.currency && quote.currency && input.currency !== quote.currency) {
								return yield* Effect.fail(
									new Error('Settlement currency must match the document currency.')
								);
							}
							return { ...input, currency: input.currency ?? quote.currency };
						}

						if (regardingType === 'purchase_orders') {
							const order = yield* api.db.purchase_orders.findFirst({
								where: { id: { eq: input.regarding_id } }
							});
							if (!order) {
								return yield* Effect.fail(new Error('Referenced purchase order does not exist.'));
							}
							if (order.status !== 'confirmed') {
								return yield* Effect.fail(
									new Error('Settlements can only be recorded against a confirmed purchase order.')
								);
							}
							if (input.currency && order.currency && input.currency !== order.currency) {
								return yield* Effect.fail(
									new Error('Settlement currency must match the document currency.')
								);
							}
							return { ...input, currency: input.currency ?? order.currency };
						}

						const invoice = yield* api.db.purchase_invoices.findFirst({
							where: { id: { eq: input.regarding_id } }
						});
						if (!invoice) {
							return yield* Effect.fail(new Error('Referenced purchase invoice does not exist.'));
						}
						if (invoice.status !== 'confirmed') {
							return yield* Effect.fail(
								new Error('Settlements can only be recorded against a confirmed purchase invoice.')
							);
						}
						if (input.currency && invoice.currency && input.currency !== invoice.currency) {
							return yield* Effect.fail(
								new Error('Settlement currency must match the document currency.')
							);
						}
						return { ...input, currency: input.currency ?? invoice.currency };
					})
			}
		}
	}
} satisfies Hooks;
