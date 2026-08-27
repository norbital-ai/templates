import { Effect, Schema } from 'effect';
import { currentInstant } from '../../lib/clock.js';
import { docNoSeriesPattern, nextDocNo } from '../../lib/document-numbers.js';
import type { Hooks, WorkspaceRow } from './$types.js';

const quoteStatusSchema = Schema.Literals([
	'draft',
	'sent',
	'won',
	'confirmed',
	'lost',
	'cancelled'
]);
type QuoteStatus = Schema.Schema.Type<typeof quoteStatusSchema>;

type QuoteUpdate = {
	-readonly [K in keyof WorkspaceRow<'quotes'>]?: WorkspaceRow<'quotes'>[K];
};

const VALID_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
	draft: ['sent', 'won', 'lost', 'cancelled'],
	sent: ['draft', 'won', 'lost'],
	won: ['confirmed', 'lost', 'cancelled'],
	confirmed: [],
	lost: ['won'],
	cancelled: []
};

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Opens a quote against an active account, assigns the next QT document number for the year, and stamps it as draft revision 1.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (!input.account_id) {
							return yield* Effect.fail(new Error('A quote must reference an account.'));
						}
						const account = yield* api.db.accounts.findFirst({
							where: { id: { eq: input.account_id } }
						});
						if (!account) {
							return yield* Effect.fail(new Error('Referenced account does not exist.'));
						}
						if (!account.active) {
							return yield* Effect.fail(
								new Error('Cannot create a quote for an inactive account.')
							);
						}
						if (input.contact_id != null) {
							const contact = yield* api.db.contacts.findFirst({
								where: { id: { eq: input.contact_id } }
							});
							if (!contact)
								return yield* Effect.fail(new Error('Referenced contact does not exist.'));
						}

						if (!input.doc_no) {
							const year = (yield* currentInstant).getFullYear();
							const existing = yield* api.db.quotes.findMany({
								where: { doc_no: { like: docNoSeriesPattern('QT', year) } },
								columns: { doc_no: true },
								limit: 5000
							});
							return {
								...input,
								doc_no: nextDocNo(
									existing.map((row) => row.doc_no),
									'QT',
									year
								),
								status: input.status ?? 'draft',
								revision_number: input.revision_number ?? 1
							};
						}

						return {
							...input,
							status: input.status ?? 'draft',
							revision_number: input.revision_number ?? 1
						};
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Polices the quote lifecycle: holds a sent or won quote immutable, demands an explicit credit acknowledgement to confirm past an account credit hold or limit, requires at least one line on active products, raises the revision number when a sent quote is reopened to draft, and requires a reason to cancel.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const newStatus = yield* Schema.decodeUnknownEffect(quoteStatusSchema)(
							input.status ?? existing.status
						);
						const oldStatus = yield* Schema.decodeUnknownEffect(quoteStatusSchema)(existing.status);

						if (oldStatus === newStatus) {
							if (oldStatus === 'draft') return input;
							return yield* Effect.fail(
								new Error(
									`A ${oldStatus} document is immutable. Revise by reopening to draft status first.`
								)
							);
						}

						const allowed = VALID_TRANSITIONS[oldStatus];
						if (!allowed.includes(newStatus)) {
							return yield* Effect.fail(
								new Error(
									`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
								)
							);
						}

						const updates: QuoteUpdate = { ...input };

						if (newStatus === 'confirmed') {
							const account = yield* api.db.accounts.findFirst({
								where: { id: { eq: existing.account_id } }
							});
							if (!account) {
								return yield* Effect.fail(new Error('Referenced account does not exist.'));
							}
							if (!account.active) {
								return yield* Effect.fail(
									new Error('Cannot confirm a quote for an inactive account.')
								);
							}

							// Credit is warn-never-blocks: an adverse verdict does not refuse the confirm, it
							// demands an explicit acknowledgment that lands on the document and in its audit trail.
							const creditAdverse =
								account.credit_hold === true ||
								(account.credit_limit != null &&
									account.credit_used != null &&
									Number(account.credit_used) + Number(existing.gross ?? 0) >
										Number(account.credit_limit));
							const acknowledged =
								input.credit_acknowledged === true || existing.credit_acknowledged === true;
							if (creditAdverse && !acknowledged) {
								return yield* Effect.fail(
									new Error(
										'Credit check is adverse (hold or over-limit). Set credit_acknowledged to confirm anyway.'
									)
								);
							}

							const lines = yield* api.db.quote_lines.findMany({
								where: { quote_id: { eq: existing.id } },
								columns: { product_id: true },
								limit: 5000
							});
							if (lines.length === 0) {
								return yield* Effect.fail(
									new Error('A quote must have at least one line before it can be confirmed.')
								);
							}

							const productIds = [...new Set(lines.map((line) => line.product_id))];
							const products = yield* api.db.products.findMany({
								where: { id: { in: productIds } },
								columns: { name: true, active: true },
								limit: 5000
							});
							const inactiveProducts = products
								.filter((product) => !product.active)
								.map((product) => product.name);
							if (inactiveProducts.length > 0) {
								return yield* Effect.fail(
									new Error(
										`Cannot confirm a quote with inactive products: ${inactiveProducts.join(', ')}.`
									)
								);
							}
						}

						if (newStatus === 'confirmed' && existing.confirmed_at == null) {
							updates.confirmed_at = (yield* currentInstant).toISOString();
						}

						if (newStatus === 'draft' && oldStatus === 'sent') {
							const currentRev = Number(existing.revision_number ?? 1);
							const originalId = existing.revision_of ?? existing.id;
							updates.revision_number = currentRev + 1;
							updates.revision_of = originalId;
						}

						if (newStatus === 'cancelled') {
							const cancelReason = input.cancel_reason ?? existing.cancel_reason;
							if (!cancelReason || String(cancelReason).trim() === '') {
								return yield* Effect.fail(new Error('A cancellation reason is required.'));
							}
							if (existing.cancelled_at == null) {
								updates.cancelled_at = (yield* currentInstant).toISOString();
							}
						}

						return updates;
					})
			}
		}
	}
} satisfies Hooks;
