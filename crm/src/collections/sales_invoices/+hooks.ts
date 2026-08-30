import {
	refuse,
	type MutateBeforeContext,
	type MutateEditContext
} from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { currentInstant } from '../../lib/clock.js';
import { docNoSeriesPattern, nextDocNo } from '../../lib/document-numbers.js';
import type { Hooks, WorkspaceRow } from './$types.js';

const invoiceStatusSchema = Schema.Literals(['draft', 'issued', 'cancelled']);
type InvoiceStatus = Schema.Schema.Type<typeof invoiceStatusSchema>;

const decodeInvoiceStatus = (value: unknown) =>
	Schema.decodeUnknownEffect(invoiceStatusSchema)(value).pipe(
		Effect.catch(() =>
			Effect.sync(() => refuse('Sales invoice status must be draft, issued, or cancelled.'))
		)
	);

type InvoiceUpdate = {
	-readonly [K in keyof WorkspaceRow<'sales_invoices'>]?: WorkspaceRow<'sales_invoices'>[K];
};

const VALID_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
	draft: ['issued', 'cancelled'],
	issued: [],
	cancelled: []
};

type BeforeContext = MutateBeforeContext<Hooks>;
type EditContext = MutateEditContext<Hooks>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, api }: BeforeContext) =>
	Effect.gen(function* () {
		if (!input.quote_id) refuse('A sales invoice must reference a quote.');
		const quote = yield* api.db.quotes.findFirst({
			where: { id: { eq: input.quote_id } }
		});
		if (!quote) refuse('Referenced quote does not exist.');
		if (quote.status !== 'confirmed') {
			refuse('Invoices can only be raised against a confirmed quote.');
		}

		const resolved = {
			...input,
			account_id: quote.account_id,
			currency: quote.currency,
			tax_inclusive: quote.tax_inclusive,
			status: input.status ?? 'draft',
			net: input.net ?? 0,
			tax: input.tax ?? 0,
			gross: input.gross ?? 0
		};

		if (!input.doc_no) {
			const year = (yield* currentInstant).getFullYear();
			const existing = yield* api.db.sales_invoices.findMany({
				where: { doc_no: { like: docNoSeriesPattern('SI', year) } },
				columns: { doc_no: true },
				limit: 5000
			});
			return {
				...resolved,
				doc_no: nextDocNo(
					existing.map((row) => row.doc_no),
					'SI',
					year
				)
			};
		}

		return resolved;
	});

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing, api }: EditContext) =>
	Effect.gen(function* () {
		const newStatus = yield* decodeInvoiceStatus(input.status ?? existing.status);
		const oldStatus = yield* decodeInvoiceStatus(existing.status);

		if (oldStatus === newStatus) {
			if (oldStatus === 'draft') return input;
			refuse(`An ${oldStatus} sales invoice is immutable. Revise by raising a new invoice.`);
		}

		const allowed = VALID_TRANSITIONS[oldStatus];
		if (!allowed.includes(newStatus)) {
			refuse(
				`Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(', ')}.`
			);
		}

		const updates: InvoiceUpdate = { ...input };

		if (newStatus === 'issued') {
			const lines = yield* api.db.sales_invoice_lines.findMany({
				where: { sales_invoice_id: { eq: existing.id } },
				limit: 1
			});
			if (lines.length === 0) {
				refuse('A sales invoice must have at least one line before it can be issued.');
			}
			if (existing.issued_at == null) {
				updates.issued_at = (yield* currentInstant).toISOString();
			}
		}

		if (newStatus === 'cancelled') {
			const cancelReason = input.cancel_reason ?? existing.cancel_reason;
			if (!cancelReason || String(cancelReason).trim() === '') {
				refuse('A cancellation reason is required.');
			}
			if (existing.cancelled_at == null) {
				updates.cancelled_at = (yield* currentInstant).toISOString();
			}
		}

		return updates;
	});

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Raises an invoice only against a confirmed quote, copies the account, currency and tax basis down from that quote, and assigns the next SI document number for the year. Freezes a sales invoice once it is issued or cancelled, requires at least one line to issue, and requires a cancellation reason to cancel.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			}
		}
	}
} satisfies Hooks;
