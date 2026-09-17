import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { batchEntries, uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

const columns = {
	regarding_type: true,
	regarding_id: true,
	amount: true,
	currency: true,
	settled_on: true,
	reference: true,
	owner_id: true
} as const;

const create = { input: { columns } } as const;
const update = create;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;
type Settlement = WorkspaceRow<'settlements'>;

const LIMIT = 5000;

/** The document a settlement lands on, as every settleable collection carries it. */
type Committed = { readonly status: string | null; readonly currency: string | null };

const labels = {
	quotes: 'quote',
	purchase_orders: 'purchase order',
	purchase_invoices: 'purchase invoice'
} as const;
type Kind = keyof typeof labels;
const isKind = (value: unknown): value is Kind => typeof value === 'string' && value in labels;

/**
 * Records a payment only against a confirmed quote, purchase order or purchase invoice, for a
 * positive amount in the currency of that document.
 */
export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const entries = batchEntries<Create, Update, Settlement>(inputs, existing);
			const targets = entries.map((entry) => ({
				type:
					entry.input.regarding_type ??
					(entry.kind === 'update' ? entry.stored.regarding_type : null),
				id: entry.input.regarding_id ?? (entry.kind === 'update' ? entry.stored.regarding_id : null)
			}));
			const idsOf = (type: Kind) =>
				uniqueIds(targets.flatMap((target) => (target.type === type ? [target.id] : [])));
			const [quoteIds, orderIds, invoiceIds] = [
				idsOf('quotes'),
				idsOf('purchase_orders'),
				idsOf('purchase_invoices')
			];
			const columnsOf = { id: true, status: true, currency: true } as const;
			const [quotes, orders, invoices] = yield* Effect.all(
				[
					quoteIds.length
						? db.quotes.findMany({
								where: { id: { in: quoteIds } },
								columns: columnsOf,
								limit: LIMIT
							})
						: Effect.succeed([]),
					orderIds.length
						? db.purchase_orders.findMany({
								where: { id: { in: orderIds } },
								columns: columnsOf,
								limit: LIMIT
							})
						: Effect.succeed([]),
					invoiceIds.length
						? db.purchase_invoices.findMany({
								where: { id: { in: invoiceIds } },
								columns: columnsOf,
								limit: LIMIT
							})
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const documents: Record<Kind, ReadonlyMap<string, Committed>> = {
				quotes: new Map(quotes.map((row) => [row.id, row])),
				purchase_orders: new Map(orders.map((row) => [row.id, row])),
				purchase_invoices: new Map(invoices.map((row) => [row.id, row]))
			};

			return entries.map((entry, i) => {
				const { input } = entry;
				const target = targets[i];
				if (!isKind(target?.type)) {
					refuse('A settlement must reference a quote, purchase order, or purchase invoice.');
				}
				if (!target?.id) refuse('A settlement must reference a document.');
				const amount = decodeNumber(
					input.amount ?? (entry.kind === 'update' ? entry.stored.amount : null)
				);
				if (Number.isNaN(amount) || amount <= 0) {
					refuse('Settlement amount must be greater than zero.');
				}
				const document = documents[target.type].get(target.id);
				if (!document) refuse(`Referenced ${labels[target.type]} does not exist.`);
				if (document.status !== 'confirmed') {
					refuse(`Settlements can only be recorded against a confirmed ${labels[target.type]}.`);
				}
				if (input.currency && document.currency && input.currency !== document.currency) {
					refuse('Settlement currency must match the document currency.');
				}
				return { ...input, currency: input.currency ?? document.currency };
			});
		})
});
