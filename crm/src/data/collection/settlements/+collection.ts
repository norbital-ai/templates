import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { num } from '../../../lib/pricing.js';

const DOCUMENTS = {
	quotes: 'quote',
	purchase_orders: 'purchase order',
	purchase_invoices: 'purchase invoice'
} as const;
type DocumentType = keyof typeof DOCUMENTS;
const columns = ['regarding', 'amount', 'currency', 'settled_on', 'reference', 'owner_id'] as const;

/**
 * Records a payment only against a confirmed quote, purchase order or purchase invoice, for a positive amount in the
 * currency of that document (taken from it when none is given).
 */
const c = collection('settlements', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } },
	queries: {
		settlement_summary: {
			description:
				'Totals the amount settled to date against each quote, purchase order or purchase invoice of the requested type.',
			input: {
				regarding_type: { kind: 'enum', values: ['quotes', 'purchase_orders', 'purchase_invoices'] }
			},
			output: {
				kind: 'object',
				fields: {
					summaries: {
						kind: 'record',
						of: { kind: 'object', fields: { paid: { kind: 'number' }, currency: { kind: 'text' } } }
					}
				}
			}
		}
	}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'settlements'>) => {
	const rows = inputs.map((input, i) => ({ ...ctx.existing[i], ...input }));
	const quoteIds = rows.flatMap((r) =>
		r.regarding?.collection === 'quotes' ? [r.regarding.id] : []
	);
	const purchaseOrderIds = rows.flatMap((r) =>
		r.regarding?.collection === 'purchase_orders' ? [r.regarding.id] : []
	);
	const purchaseInvoiceIds = rows.flatMap((r) =>
		r.regarding?.collection === 'purchase_invoices' ? [r.regarding.id] : []
	);
	const [quotes, purchase_orders, purchase_invoices] = await Promise.all([
		quoteIds.length
			? ctx.db.read('quotes', { where: { id: { in: quoteIds } }, all: true })
			: { rows: [] },
		purchaseOrderIds.length
			? ctx.db.read('purchase_orders', { where: { id: { in: purchaseOrderIds } }, all: true })
			: { rows: [] },
		purchaseInvoiceIds.length
			? ctx.db.read('purchase_invoices', { where: { id: { in: purchaseInvoiceIds } }, all: true })
			: { rows: [] }
	]);
	const documentFor = (ref: { readonly collection: DocumentType; readonly id: unknown }) => {
		switch (ref.collection) {
			case 'quotes':
				return quotes.rows.find((d) => d.id === ref.id);
			case 'purchase_orders':
				return purchase_orders.rows.find((d) => d.id === ref.id);
			case 'purchase_invoices':
				return purchase_invoices.rows.find((d) => d.id === ref.id);
			default: {
				const _exhaustive: never = ref.collection;
				return _exhaustive;
			}
		}
	};
	return inputs.map((input, i) => {
		const ref = rows[i]!.regarding;
		if (ref == null)
			ctx.refuse('A settlement must reference a quote, purchase order, or purchase invoice.');
		const label = DOCUMENTS[ref.collection];
		if (!(num(rows[i]!.amount) > 0)) ctx.refuse('Settlement amount must be greater than zero.');
		const document = documentFor(ref);
		if (!document) ctx.refuse(`Referenced ${label} does not exist.`);
		if (document.status !== 'confirmed')
			ctx.refuse(`Settlements can only be recorded against a confirmed ${label}.`);
		if (input.currency && document.currency && input.currency !== document.currency)
			ctx.refuse('Settlement currency must match the document currency.');
		return {
			...input,
			...(ctx.existing[i] === undefined && input.currency == null
				? { currency: document.currency }
				: {})
		};
	});
});

/** Paid-to-date per document of one type, so a surface derives paid / partial / unpaid against the document gross. */
c.query('settlement_summary', async ({ regarding_type }, ctx) => {
	const rows =
		regarding_type === 'quotes'
			? await ctx.read('settlements', {
					where: { regarding: { quotes: { isNull: false } } },
					all: true
				})
			: regarding_type === 'purchase_orders'
				? await ctx.read('settlements', {
						where: { regarding: { purchase_orders: { isNull: false } } },
						all: true
					})
				: await ctx.read('settlements', {
						where: { regarding: { purchase_invoices: { isNull: false } } },
						all: true
					});
	const summaries: { [id: string]: { paid: number; currency: string } } = {};
	for (const row of rows.rows) {
		const id = String(row.regarding.id);
		summaries[id] = {
			paid: (summaries[id]?.paid ?? 0) + num(row.amount),
			currency: summaries[id]?.currency ?? row.currency ?? ''
		};
	}
	return { summaries };
});
