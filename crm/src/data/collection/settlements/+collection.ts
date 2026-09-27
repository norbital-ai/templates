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
	const types = Object.keys(DOCUMENTS) as DocumentType[];
	const found = await Promise.all(
		types.map((type) =>
			ctx.db.read(type, {
				where: {
					id: {
						in: rows.flatMap((r) => (r.regarding?.collection === type ? [r.regarding.id] : []))
					}
				} as never,
				all: true
			})
		)
	);
	return inputs.map((input, i) => {
		const ref = rows[i]!.regarding;
		if (ref == null)
			ctx.refuse('A settlement must reference a quote, purchase order, or purchase invoice.');
		const label = DOCUMENTS[ref.collection];
		if (!(num(rows[i]!.amount) > 0)) ctx.refuse('Settlement amount must be greater than zero.');
		const document = found[types.indexOf(ref.collection)]!.rows.find((d) => d.id === ref.id);
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
	const rows = await ctx.read('settlements', {
		where: { regarding: { [regarding_type]: { isNull: false } } } as never,
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
