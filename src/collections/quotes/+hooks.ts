import { Effect } from 'effect';
import type { Hooks, WorkspaceRow } from './$types.js';

const DOC_NO_SEQUENCE_WIDTH = 4;

function docNoSeriesPattern(prefix: string, year: number): string {
	return `${prefix}-${year}-%`;
}

function nextDocNo(existingNumbers: readonly string[], prefix: string, year: number): string {
	const seriesPrefix = `${prefix}-${year}-`;
	let highest = 0;
	for (const number of existingNumbers) {
		if (!number.startsWith(seriesPrefix)) continue;
		const sequence = Number.parseInt(number.slice(seriesPrefix.length), 10);
		if (Number.isNaN(sequence)) continue;
		if (sequence > highest) highest = sequence;
	}
	return `${seriesPrefix}${String(highest + 1).padStart(DOC_NO_SEQUENCE_WIDTH, '0')}`;
}

type QuoteStatus = 'draft' | 'sent' | 'won' | 'confirmed' | 'lost' | 'cancelled';

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
		before: {
			description:
				'Opens a quote against an active account, assigns the next QT document number for the year, and stamps it as draft revision 1.',
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					if (!input.account_id) throw new Error('A quote must reference an account.');
					const account = yield* api.db.query.accounts.findFirst({
						where: { norbital_id: { eq: input.account_id } }
					});
					if (!account) throw new Error('Referenced account does not exist.');
					if (!account.active) {
						throw new Error('Cannot create a quote for an inactive account.');
					}
					if (input.contact_id != null) {
						const contact = yield* api.db.query.contacts.findFirst({
							where: { norbital_id: { eq: input.contact_id } }
						});
						if (!contact) throw new Error('Referenced contact does not exist.');
					}

					if (!input.doc_no) {
						const year = new Date().getFullYear();
						const existing = yield* api.db.query.quotes.findMany({
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
	},
	update: {
		before: {
			description:
				'Polices the quote lifecycle: holds a sent or won quote immutable, demands an explicit credit acknowledgement to confirm past an account credit hold or limit, requires at least one line on active products, raises the revision number when a sent quote is reopened to draft, and requires a reason to cancel.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
					const newStatus = (input.status ?? existing.status) as QuoteStatus;
					const oldStatus = existing.status as QuoteStatus;

					if (oldStatus === newStatus) {
						if (oldStatus === 'draft') return input;
						throw new Error(
							`A ${oldStatus} document is immutable. Revise by reopening to draft status first.`
						);
					}

					const allowed = VALID_TRANSITIONS[oldStatus];
					if (!allowed.includes(newStatus)) {
						throw new Error(
							`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
						);
					}

					const updates: QuoteUpdate = { ...input };

					if (newStatus === 'confirmed') {
						const account = yield* api.db.query.accounts.findFirst({
							where: { norbital_id: { eq: existing.account_id } }
						});
						if (!account) throw new Error('Referenced account does not exist.');
						if (!account.active) {
							throw new Error('Cannot confirm a quote for an inactive account.');
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
							throw new Error(
								'Credit check is adverse (hold or over-limit). Set credit_acknowledged to confirm anyway.'
							);
						}

						const lines = yield* api.db.query.quote_lines.findMany({
							where: { quote_id: { eq: existing.norbital_id } },
							columns: { product_id: true },
							limit: 5000
						});
						if (lines.length === 0) {
							throw new Error('A quote must have at least one line before it can be confirmed.');
						}

						const productIds = [...new Set(lines.map((line) => line.product_id))];
						const products = yield* api.db.query.products.findMany({
							where: { norbital_id: { in: productIds } },
							columns: { name: true, active: true },
							limit: 5000
						});
						const inactiveProducts = products
							.filter((product) => !product.active)
							.map((product) => product.name);
						if (inactiveProducts.length > 0) {
							throw new Error(
								`Cannot confirm a quote with inactive products: ${inactiveProducts.join(', ')}.`
							);
						}
					}

					if (newStatus === 'confirmed' && existing.confirmed_at == null) {
						updates.confirmed_at = new Date();
					}

					if (newStatus === 'draft' && oldStatus === 'sent') {
						const currentRev = Number(existing.revision_number ?? 1);
						const originalId = existing.revision_of ?? existing.norbital_id;
						updates.revision_number = currentRev + 1;
						updates.revision_of = originalId;
					}

					if (newStatus === 'cancelled') {
						const cancelReason = input.cancel_reason ?? existing.cancel_reason;
						if (!cancelReason || String(cancelReason).trim() === '') {
							throw new Error('A cancellation reason is required.');
						}
						if (existing.cancelled_at == null) updates.cancelled_at = new Date();
					}

					return updates;
				})
		}
	}
} satisfies Hooks;
