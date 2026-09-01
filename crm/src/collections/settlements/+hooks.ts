import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

const COMMITTED_TARGETS = {
	quotes: 'confirmed',
	purchase_orders: 'confirmed',
	purchase_invoices: 'confirmed'
} as const;

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Records a payment only against a confirmed quote, purchase order or purchase invoice, for a positive amount in the currency of that document.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						const regardingType = input.regarding_type ?? '';
						if (!(regardingType in COMMITTED_TARGETS)) {
							refuse('A settlement must reference a quote, purchase order, or purchase invoice.');
						}
						if (!input.regarding_id) {
							refuse('A settlement must reference a document.');
						}

						const amount = Number(input.amount);
						if (Number.isNaN(amount) || amount <= 0) {
							refuse('Settlement amount must be greater than zero.');
						}

						if (regardingType === 'quotes') {
							const quote = yield* api.db.quotes.findFirst({
								where: { id: { eq: input.regarding_id } }
							});
							if (!quote) {
								refuse('Referenced quote does not exist.');
							}
							if (quote.status !== 'confirmed') {
								refuse('Settlements can only be recorded against a confirmed quote.');
							}
							if (input.currency && quote.currency && input.currency !== quote.currency) {
								refuse('Settlement currency must match the document currency.');
							}
							return { ...input, currency: input.currency ?? quote.currency };
						}

						if (regardingType === 'purchase_orders') {
							const order = yield* api.db.purchase_orders.findFirst({
								where: { id: { eq: input.regarding_id } }
							});
							if (!order) {
								refuse('Referenced purchase order does not exist.');
							}
							if (order.status !== 'confirmed') {
								refuse('Settlements can only be recorded against a confirmed purchase order.');
							}
							if (input.currency && order.currency && input.currency !== order.currency) {
								refuse('Settlement currency must match the document currency.');
							}
							return { ...input, currency: input.currency ?? order.currency };
						}

						const invoice = yield* api.db.purchase_invoices.findFirst({
							where: { id: { eq: input.regarding_id } }
						});
						if (!invoice) {
							refuse('Referenced purchase invoice does not exist.');
						}
						if (invoice.status !== 'confirmed') {
							refuse('Settlements can only be recorded against a confirmed purchase invoice.');
						}
						if (input.currency && invoice.currency && input.currency !== invoice.currency) {
							refuse('Settlement currency must match the document currency.');
						}
						return { ...input, currency: input.currency ?? invoice.currency };
					})
			}
		}
	}
} satisfies Hooks;
