import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { currentInstant } from '../../lib/clock.js';
import { docNoSeries, docNoSeriesPattern } from '../../lib/document-numbers.js';
import { assertTransition, batchEntries, requireReason, uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

type Invoice = WorkspaceRow<'sales_invoices'>;
type InvoiceStatus = NonNullable<Invoice['status']>;

const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
	draft: ['issued', 'cancelled'],
	issued: [],
	cancelled: []
};

/** The account, currency and tax basis come down from the quote; `doc_no` is issued here. */
const create = { input: { columns: { quote_id: true, owner_id: true, status: true } } } as const;
/** `net`, `tax` and `gross` are written by the line roll-up automations. */
const update = {
	input: {
		columns: {
			doc_no: true,
			owner_id: true,
			status: true,
			cancel_reason: true,
			net: true,
			tax: true,
			gross: true
		}
	}
} as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;

const LIMIT = 5000;

/**
 * Raises an invoice only against a confirmed quote, copies the account, currency and tax basis
 * down from that quote, and assigns the next SI document number for the year. Freezes a sales
 * invoice once it is issued or cancelled, requires at least one line to issue, and requires a
 * cancellation reason to cancel.
 */
export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const now = yield* currentInstant;
			const year = now.getFullYear();
			const entries = batchEntries<Create, Update, Invoice>(inputs, existing);
			const quoteIds = uniqueIds(
				entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input.quote_id] : []))
			);
			const issuingIds = entries.flatMap((entry) =>
				entry.kind === 'update' && entry.input.status === 'issued' ? [entry.stored.id] : []
			);
			const [quotes, issued, lines] = yield* Effect.all(
				[
					quoteIds.length
						? db.quotes.findMany({ where: { id: { in: quoteIds } }, limit: LIMIT })
						: Effect.succeed([]),
					quoteIds.length
						? db.sales_invoices.findMany({
								where: { doc_no: { like: docNoSeriesPattern('SI', year) } },
								columns: { doc_no: true },
								limit: LIMIT
							})
						: Effect.succeed([]),
					issuingIds.length
						? db.sales_invoice_lines.findMany({
								where: { sales_invoice_id: { in: issuingIds } },
								columns: { sales_invoice_id: true },
								limit: LIMIT
							})
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
			const nextDocNo = docNoSeries(
				issued.map((invoice) => invoice.doc_no),
				'SI',
				year
			);
			const withLines = new Set(lines.map((line) => line.sales_invoice_id));

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const quote = quoteById.get(input.quote_id);
					if (!quote) refuse('Referenced quote does not exist.');
					if (quote.status !== 'confirmed') {
						refuse('Invoices can only be raised against a confirmed quote.');
					}
					return {
						...input,
						doc_no: nextDocNo(),
						account_id: quote.account_id,
						currency: quote.currency,
						tax_inclusive: quote.tax_inclusive,
						status: input.status ?? 'draft',
						net: 0,
						tax: 0,
						gross: 0
					};
				}
				const { input, stored } = entry;
				const oldStatus = stored.status ?? 'draft';
				const newStatus = input.status ?? oldStatus;
				if (oldStatus === newStatus) {
					if (oldStatus === 'draft') return input;
					refuse(`An ${oldStatus} sales invoice is immutable. Revise by raising a new invoice.`);
				}
				assertTransition(TRANSITIONS, oldStatus, newStatus);
				const stamps: { issued_at?: string; cancelled_at?: string } = {};
				if (newStatus === 'issued') {
					if (!withLines.has(stored.id)) {
						refuse('A sales invoice must have at least one line before it can be issued.');
					}
					if (stored.issued_at == null) stamps.issued_at = now.toISOString();
				}
				if (newStatus === 'cancelled') {
					requireReason(input.cancel_reason ?? stored.cancel_reason, 'cancellation');
					if (stored.cancelled_at == null) stamps.cancelled_at = now.toISOString();
				}
				return { ...input, ...stamps };
			});
		})
});
