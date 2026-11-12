import { Array, Effect, Schema } from 'effect';
import type { Authority, Json } from '@norbital-ai/bolt/engine';
import { randomUUID } from 'node:crypto';
import { type T } from './kit.js';
import { fixtureId } from './test-runtime.js';
import type { Id } from '@norbital-ai/bolt';
/** A committed sync page's record of `model`, by the remote identity its first row named. */
export function writtenId<C extends string>(
	model: C,
	outcome: Effect.Success<ReturnType<typeof sync>>
) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	const [id] = outcome.ids;
	if (id === undefined) throw new Error(`The sync committed no ${model} record`);
	return fixtureId(model, id);
}
/** Invalid and forbidden wire requests cannot be expressed by the typed caller catalogue: an untyped map, its outcome or failure. */
export const direct = Effect.fnUntraced(function* (
	t: T,
	authority: Authority,
	request: { readonly model: string; readonly verb: string; readonly input: Json }
) {
	const acts: Record<string, Json> = { [`${request.model}.${request.verb}`]: request.input };
	return yield* (yield* t.as(authority)).act(acts).pipe(Effect.catch(Effect.succeed));
});
/** The remote identity of each model these helpers write as the `kingdee` sync (with `source`, its import key). */
const remote = {
	parties: 'external_code',
	products: 'external_code',
	warehouses: 'external_code',
	stock_snapshots: 'external_code',
	credit_snapshots: 'external_code',
	source_sales_lines: 'external_code',
	ext_sales_orders: 'external_id',
	ext_purchase_orders: 'external_id',
	transactions: 'erp_id',
	source_payments: 'external_code'
} as const;
/**
 * Commits rows as one `kingdee` sync read page (`t.syncs.write`), without the read body: the model's write callbacks
 * judge them, and the import key reuses the record an earlier page wrote for the same remote identity. Answers the
 * page's records in row order, or the act's failure.
 */
export const sync = Effect.fnUntraced(function* <C extends keyof typeof remote>(
	t: T,
	model: C,
	row: Record<string, Json> | Record<string, Json>[]
) {
	const rows = (Array.isArray(row) ? row : [row]).map((value) => ({ ...value, source: 'kingdee' }));
	const key = (value: Record<string, Json>) => String(value[remote[model]]);
	const refused = yield* t.syncs.write(`${model}.sync.kingdee`, rows).pipe(
		Effect.as(null),
		Effect.catchTags({
			ActRefused: Effect.succeed,
			ActConflict: Effect.succeed,
			ActUnknown: Effect.succeed
		})
	);
	if (refused !== null) return { kind: 'refused', failure: refused } as const;
	const stored = yield* t.db.rows(Schema.Struct({ id: Schema.String, remote: Schema.String }), {
		text: `SELECT id, "${remote[model]}" AS remote FROM "${model}" WHERE source = 'kingdee' AND "${remote[model]}" IN (SELECT jsonb_array_elements_text($1::jsonb))`,
		params: [rows.map(key)]
	});
	return {
		kind: 'committed',
		ids: rows.flatMap((value) =>
			stored.filter((row) => row.remote === key(value)).map((row) => row.id)
		)
	} as const;
});
/** No sync writes supplier confirmations (`ext_purchase_orders` retains existing evidence): one stored as it stands. */
const retainedPurchaseOrder = Effect.fnUntraced(function* (
	t: T,
	input: Record<
		| 'order'
		| 'external_id'
		| 'reference'
		| 'agreement_hash'
		| 'currency'
		| 'status'
		| 'source_updated_at',
		string
	>
) {
	const id = fixtureId('ext_purchase_orders', randomUUID());
	yield* t.db.write({
		text: `INSERT INTO ext_purchase_orders (id, "order", external_id, reference, agreement_hash, currency, status, source_updated_at, source)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'kingdee')`,
		params: [
			id,
			input.order,
			input.external_id,
			input.reference,
			input.agreement_hash,
			input.currency,
			input.status,
			input.source_updated_at
		]
	});
	return id;
});
export const sourceOrder = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const agreement = (yield* (yield* t.as(t.admin)).query({
		orders: { where: { id: { eq: order } }, limit: 1 }
	})).orders.rows[0];
	if (typeof agreement?.seal_hash !== 'string' || typeof agreement.currency !== 'string')
		throw new Error('Sealed agreement required');
	const model: 'ext_sales_orders' | 'ext_purchase_orders' =
		agreement.direction === 'sales' ? 'ext_sales_orders' : 'ext_purchase_orders';
	const input = {
		order,
		external_id: randomUUID(),
		reference: 'CONFIRMED',
		agreement_hash: agreement.seal_hash,
		currency: agreement.currency,
		status: 'issued',
		source_updated_at: '2026-10-10T00:00:00Z'
	};
	return {
		id:
			model === 'ext_sales_orders'
				? writtenId(model, yield* sync(t, model, input))
				: yield* retainedPurchaseOrder(t, input),
		model,
		input,
		agreement
	};
});
export const sourceTransaction = Effect.fnUntraced(function* (
	t: T,
	own: {
		order: Id<'orders'>;
		line: Id<'order_lines'>;
	},
	parent: Effect.Success<ReturnType<typeof sourceOrder>>,
	kind: 'invoice' | 'delivery' = 'invoice',
	quantity: string = '4',
	overrides: Record<string, Json> = {}
) {
	const input = {
		erp_id: randomUUID(),
		order: own.order,
		[parent.model === 'ext_sales_orders' ? 'ext_sales_order' : 'ext_purchase_order']: parent.id,
		kind,
		reference: kind === 'invoice' ? 'INV-1' : 'DO-1',
		seal_hash: parent.input.agreement_hash,
		currency: parent.input.currency,
		status: 'issued',
		issued_on: '2026-08-01',
		due_on: '2026-08-10',
		total: '21.80',
		source_updated_at: '2026-10-10T00:00:00Z',
		items: [
			{ order_line_id: own.line, product_name: 'Resin A', unit: 'kg', quantity, unit_price: '2' }
		],
		documents: [
			{ name: `${kind}.pdf`, url: `https://example.test/${kind}.pdf`, sha256: 'a'.repeat(64) }
		],
		...overrides
	};
	return {
		id: writtenId('transactions', yield* sync(t, 'transactions', [input])),
		input
	};
});
export const sourcePayment = Effect.fnUntraced(function* (
	t: T,
	parent: Effect.Success<ReturnType<typeof sourceOrder>>,
	invoice: Id<'transactions'> | null,
	amount: string,
	reference: string = randomUUID(),
	overrides: Record<string, Json> = {}
) {
	const input = {
		order: parent.input.order,
		invoice,
		external_code: reference,
		reference,
		kind: amount.startsWith('-') ? 'refund' : 'receipt',
		amount,
		currency: parent.input.currency,
		seal_hash: parent.input.agreement_hash,
		settled_on: '2026-10-09',
		source_updated_at: '2026-10-10T00:00:00Z',
		active: true,
		...overrides
	};
	return {
		id: writtenId('source_payments', yield* sync(t, 'source_payments', [input])),
		input
	};
});
