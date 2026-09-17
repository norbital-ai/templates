import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { currentInstant } from '../../lib/clock.js';
import { docNoSeries, docNoSeriesPattern } from '../../lib/document-numbers.js';
import {
	assertTransition,
	batchEntries,
	groupBy,
	requireReason,
	uniqueIds
} from '../../lib/lifecycle.js';
import model from './+model.js';

type Quote = WorkspaceRow<'quotes'>;
type QuoteStatus = NonNullable<Quote['status']>;

const TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
	draft: ['sent', 'won', 'lost', 'cancelled'],
	sent: ['draft', 'won', 'lost'],
	won: ['confirmed', 'lost', 'cancelled'],
	confirmed: [],
	lost: ['won'],
	cancelled: []
};

/** The commercial terms a rep states on a quote, on creation and while it is a draft. */
const terms = {
	account_id: true,
	contact_id: true,
	title: true,
	status: true,
	currency: true,
	tax_inclusive: true,
	valid_until: true,
	payment_terms: true,
	shipping_terms: true,
	place_of_loading: true,
	place_of_delivery: true,
	packaging: true,
	shipping_mark: true,
	time_of_shipment: true,
	other_terms: true,
	owner_id: true,
	description: true,
	revision_of: true,
	revision_number: true
} as const;

/** `doc_no` is issued by the transform. */
const create = { input: { columns: terms } } as const;
/** `net`, `tax` and `gross` are written by the line roll-up automations; the rest by the desk. */
const update = {
	input: {
		columns: {
			...terms,
			doc_no: true,
			credit_acknowledged: true,
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
 * Opens a quote against an active account, assigns the next QT document number for the year, and
 * stamps it as draft revision 1. Polices the quote lifecycle: holds a sent or won quote immutable,
 * demands an explicit credit acknowledgement to confirm past an account credit hold or limit,
 * requires at least one line on active products, raises the revision number when a sent quote is
 * reopened to draft, and requires a reason to cancel.
 */
export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const now = yield* currentInstant;
			const year = now.getFullYear();
			const entries = batchEntries<Create, Update, Quote>(inputs, existing);
			const creates = entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input] : []));
			const confirming = entries.flatMap((entry) =>
				entry.kind === 'update' && entry.input.status === 'confirmed' ? [entry.stored] : []
			);

			// Wave 1: everything the inputs alone can name.
			const accountIds = uniqueIds([
				...creates.map((input) => input.account_id),
				...confirming.map((quote) => quote.account_id)
			]);
			const contactIds = uniqueIds(creates.map((input) => input.contact_id));
			const confirmingIds = confirming.map((quote) => quote.id);
			const [accounts, contacts, issued, lines] = yield* Effect.all(
				[
					accountIds.length
						? db.accounts.findMany({ where: { id: { in: accountIds } }, limit: LIMIT })
						: Effect.succeed([]),
					contactIds.length
						? db.contacts.findMany({
								where: { id: { in: contactIds } },
								columns: { id: true },
								limit: LIMIT
							})
						: Effect.succeed([]),
					creates.length
						? db.quotes.findMany({
								where: { doc_no: { like: docNoSeriesPattern('QT', year) } },
								columns: { doc_no: true },
								limit: LIMIT
							})
						: Effect.succeed([]),
					confirmingIds.length
						? db.quote_lines.findMany({
								where: { quote_id: { in: confirmingIds } },
								columns: { quote_id: true, product_id: true },
								limit: LIMIT
							})
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			// Wave 2: the products the confirming quotes' lines name.
			const productIds = uniqueIds(lines.map((line) => line.product_id));
			const products = productIds.length
				? yield* db.products.findMany({
						where: { id: { in: productIds } },
						columns: { id: true, name: true, active: true },
						limit: LIMIT
					})
				: [];

			const accountById = new Map(accounts.map((account) => [account.id, account]));
			const knownContacts = new Set(contacts.map((contact) => contact.id));
			const nextDocNo = docNoSeries(
				issued.map((quote) => quote.doc_no),
				'QT',
				year
			);
			const linesByQuote = groupBy(lines, (line) => line.quote_id);
			const productById = new Map(products.map((product) => [product.id, product]));

			const onCreate = (input: Create) => {
				const account = accountById.get(input.account_id);
				if (!account) refuse('Referenced account does not exist.');
				if (!account.active) refuse('Cannot create a quote for an inactive account.');
				if (input.contact_id != null && !knownContacts.has(input.contact_id)) {
					refuse('Referenced contact does not exist.');
				}
				return {
					...input,
					doc_no: nextDocNo(),
					status: input.status ?? 'draft',
					revision_number: input.revision_number ?? 1
				};
			};

			const onUpdate = (input: Update, stored: Quote) => {
				const oldStatus = stored.status ?? 'draft';
				const newStatus = input.status ?? oldStatus;
				if (oldStatus === newStatus) {
					if (oldStatus === 'draft') return input;
					refuse(
						`A ${oldStatus} document is immutable. Revise by reopening to draft status first.`
					);
				}
				assertTransition(TRANSITIONS, oldStatus, newStatus);

				const stamps: {
					confirmed_at?: string;
					cancelled_at?: string;
					revision_number?: number;
					revision_of?: string;
				} = {};

				if (newStatus === 'confirmed') {
					const account = accountById.get(stored.account_id);
					if (!account) refuse('Referenced account does not exist.');
					if (!account.active) refuse('Cannot confirm a quote for an inactive account.');
					// Credit is warn-never-blocks: an adverse verdict does not refuse the confirm, it
					// demands an explicit acknowledgment that lands on the document and in its audit trail.
					const creditAdverse =
						account.credit_hold === true ||
						(account.credit_limit != null &&
							account.credit_used != null &&
							decodeNumber(account.credit_used) + decodeNumber(stored.gross ?? 0) >
								decodeNumber(account.credit_limit));
					const acknowledged =
						input.credit_acknowledged === true || stored.credit_acknowledged === true;
					if (creditAdverse && !acknowledged) {
						refuse(
							'Credit check is adverse (hold or over-limit). Set credit_acknowledged to confirm anyway.'
						);
					}
					const quoteLines = linesByQuote.get(stored.id) ?? [];
					if (quoteLines.length === 0) {
						refuse('A quote must have at least one line before it can be confirmed.');
					}
					const inactive = uniqueIds(quoteLines.map((line) => line.product_id)).flatMap((id) => {
						const product = productById.get(id);
						return product !== undefined && !product.active ? [product.name] : [];
					});
					if (inactive.length > 0) {
						refuse(`Cannot confirm a quote with inactive products: ${inactive.join(', ')}.`);
					}
					if (stored.confirmed_at == null) stamps.confirmed_at = now.toISOString();
				}

				if (newStatus === 'draft' && oldStatus === 'sent') {
					stamps.revision_number = decodeNumber(stored.revision_number ?? 1) + 1;
					stamps.revision_of = stored.revision_of ?? stored.id;
				}

				if (newStatus === 'cancelled') {
					requireReason(input.cancel_reason ?? stored.cancel_reason, 'cancellation');
					if (stored.cancelled_at == null) stamps.cancelled_at = now.toISOString();
				}

				return { ...input, ...stamps };
			};

			return entries.map((entry) =>
				entry.kind === 'create' ? onCreate(entry.input) : onUpdate(entry.input, entry.stored)
			);
		})
});
