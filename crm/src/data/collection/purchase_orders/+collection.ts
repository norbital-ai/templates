import { collection, type PlainDate, type TransformCtx } from '@norbital-ai/bolt';
import { addDays } from '@norbital-ai/std/date';
import { EXPORT_OUTPUT, orderDocument } from '../../../lib/document-export.js';
import { missingReason, num, reprices } from '../../../lib/pricing.js';

const EXPECTED_LEAD_DAYS = 14;
const plusDays = (day: PlainDate, days: number) => addDays(day, days);

/** The terms the purchaser states on an order, on creation and while it is a draft. */
const terms = ['owner_id', 'status', 'currency', 'tax_inclusive', 'expected_date'] as const;

/**
 * Opens an order against an active supplier, copying down its code, name and currency and expecting delivery two weeks
 * out (numbered `PO-<year>-<n>`). Submitting needs at least one line; cancelling needs a reason; a submitted order
 * takes only its confirmation or cancellation, and a confirmed or cancelled one is frozen. A draft's currency and tax
 * basis hold still under its priced lines.
 */
const c = collection('purchase_orders', {
	read: { fields: 'all' },
	create: { input: { columns: ['supplier_id', ...terms] } },
	update: { input: { columns: [...terms, 'cancel_reason'] } },
	queries: {
		export_confirmed: {
			description:
				'Packages each confirmed purchase order with its lines as a JSON document for the downstream system to receive.',
			input: { ids: { kind: 'list', of: { kind: 'id', of: 'purchase_orders' }, min: 1 } },
			output: EXPORT_OUTPUT
		},
		purchase_matching: {
			description:
				'Reports ordered, received and invoiced quantities line by line for one purchase order, plus what is still outstanding to receive.',
			input: { purchase_order_id: { kind: 'id', of: 'purchase_orders' } },
			output: {
				kind: 'object',
				fields: {
					lines: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								purchase_order_line_id: { kind: 'id', of: 'purchase_order_lines' },
								product_code: { kind: 'text' },
								product_name: { kind: 'text' },
								ordered: { kind: 'number' },
								received: { kind: 'number' },
								invoiced: { kind: 'number' },
								remaining_to_receive: { kind: 'number' }
							}
						}
					}
				}
			}
		}
	}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'purchase_orders'>) => {
	const lineChecked = inputs.flatMap((input, i) => {
		const stored = ctx.existing[i];
		return input.status === 'submitted' || (stored !== undefined && reprices(input, stored))
			? [stored!.id]
			: [];
	});
	const [suppliers, lines] = await Promise.all([
		ctx.db.read('suppliers', {
			where: { id: { in: inputs.flatMap((input) => input.supplier_id ?? []) } },
			all: true
		}),
		ctx.db.read('purchase_order_lines', {
			where: { purchase_order_id: { in: lineChecked } },
			all: true
		})
	]);
	const withLines = new Set(lines.rows.map((l) => l.purchase_order_id));
	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored === undefined) {
			const supplier = suppliers.rows.find((s) => s.id === input.supplier_id);
			if (!supplier) ctx.refuse('Referenced supplier does not exist.');
			if (!supplier.active) ctx.refuse('Cannot create a purchase order for an inactive supplier.');
			return {
				...input,
				supplier_code: supplier.code,
				supplier_name: supplier.name,
				currency: input.currency ?? supplier.currency,
				expected_date: input.expected_date ?? plusDays(ctx.today, EXPECTED_LEAD_DAYS)
			};
		}
		const from = stored.status,
			to = input.status ?? from;
		if (from === to) {
			if (from !== 'draft')
				ctx.refuse(`A ${from} purchase order is immutable. Revise by starting a new order.`);
			// lines are priced once, in the order's currency and tax basis: neither moves under them
			if (reprices(input, stored) && withLines.has(stored.id))
				ctx.refuse(
					'Currency and tax basis cannot change once the order has lines. Remove the lines first.'
				);
			return input;
		}
		if (to === 'submitted' && !withLines.has(stored.id))
			ctx.refuse('A purchase order must have at least one line before it can be submitted.');
		if (to === 'confirmed' && stored.confirmed_at == null)
			return { ...input, confirmed_at: ctx.now };
		if (to === 'cancelled') {
			if (missingReason(input.cancel_reason ?? stored.cancel_reason))
				ctx.refuse('A cancellation reason is required.');
			return { ...input, ...(stored.cancelled_at == null ? { cancelled_at: ctx.now } : {}) };
		}
		return input;
	});
});

/** The three-way match: ordered from the lines, received from their roll-up, invoiced from live purchase invoices. */
c.query('purchase_matching', async ({ purchase_order_id }, ctx) => {
	const lines = await ctx.read('purchase_order_lines', {
		where: { purchase_order_id: { eq: purchase_order_id } },
		all: true
	});
	const invoiced = await ctx.read('purchase_invoice_lines', {
		where: {
			purchase_order_line_id: { in: lines.rows.map((l) => l.id) },
			purchase_invoice_id: { is: { status: { ne: 'cancelled' } } }
		},
		all: true
	});
	return {
		lines: lines.rows.map((line) => {
			const ordered = num(line.quantity),
				received = num(line.received);
			return {
				purchase_order_line_id: line.id,
				product_code: line.product_code,
				product_name: line.product_name,
				ordered,
				received,
				invoiced: invoiced.rows
					.filter((x) => x.purchase_order_line_id === line.id)
					.reduce((s, x) => s + num(x.quantity), 0),
				remaining_to_receive: ordered - received
			};
		})
	};
});

/** `norbital.crm.confirmed_purchase_order.v1`, one per confirmed order the caller may read. */
c.query('export_confirmed', async ({ ids }, ctx) => {
	const docs = await ctx.read('purchase_orders', {
		where: { id: { in: ids }, status: { eq: 'confirmed' } },
		all: true
	});
	const lines = await ctx.read('purchase_order_lines', {
		where: { purchase_order_id: { in: docs.rows.map((d) => d.id) } },
		all: true
	});
	return {
		documents: docs.rows.map((d) =>
			orderDocument(
				d,
				lines.rows.filter((l) => l.purchase_order_id === d.id)
			)
		)
	};
});
