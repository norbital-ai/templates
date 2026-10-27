import { Array, Context, Effect, Schema } from 'effect';
import {
	Identity,
	Writes,
	type ActRequest,
	type Authority,
	type Json,
	type Outcome
} from '@norbital-ai/bolt/engine';
import { randomUUID } from 'node:crypto';
import { type T } from './kit.js';
import { fixtureId } from './test-runtime.js';
import type { Id } from '@norbital-ai/bolt';
export function writtenId<C extends string>(model: C, outcome: Outcome) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	const record = outcome.records.find((record) => record.model === model);
	if (record === undefined) throw new Error(`The sync committed no ${model} record`);
	return fixtureId(model, record.id);
}
/** Invalid and forbidden wire requests cannot be expressed by the typed caller catalogue. */
export const direct = Effect.fnUntraced(function* (
	t: T,
	authority: Authority,
	request: Pick<ActRequest, 'model' | 'verb' | 'input'>
) {
	const key = randomUUID();
	return (yield* Context.get(t.services, Writes).act({
		...request,
		mode: { _tag: 'Direct' },
		key,
		authority,
		issuedAt: t.clock.now(),
		invocationId: key,
		bindings: {
			now: t.clock.now(),
			today: t.clock.now().slice(0, 10),
			tz: t.manifest.workspace.tz,
			params: {}
		}
	})).outcome;
});
/** The remote identity of each model these helpers write as the `kingdee` sync. */
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
/** The records each workspace's sync pages wrote, by model and remote identity: the engine's id map, as a page sees it. */
const written = new WeakMap<T, Map<string, string>>();
/**
 * Writes rows as one `kingdee` sync read page would (one act in Sync mode on the instance `kingdee`), without the read
 * body: the model's write callbacks judge them. `upsert` reuses the record an earlier page wrote for the same remote
 * identity; `create` always names a new record.
 */
export const sync = Effect.fnUntraced(function* <C extends keyof typeof remote>(
	t: T,
	model: C,
	row: Record<string, Json> | Record<string, Json>[],
	verb: 'create' | 'upsert' = 'create'
) {
	const key = randomUUID();
	const name = `${model}.sync.kingdee`;
	const ids = written.get(t) ?? new Map<string, string>();
	written.set(t, ids);
	const existing =
		verb === 'upsert'
			? yield* t.db.rows(Schema.Struct({ id: Schema.String, remote: Schema.String }), {
					text: `SELECT id, "${remote[model]}" AS remote FROM "${model}" WHERE source = $1`,
					params: ['kingdee']
				})
			: [];
	const rows = (Array.isArray(row) ? row : [row]).map((value) => {
		const identity = `${model}:${String(value[remote[model]])}`;
		return {
			identity,
			value: {
				...value,
				id:
					(verb === 'upsert'
						? (ids.get(identity) ??
							existing.find((row) => row.remote === String(value[remote[model]]))?.id)
						: undefined) ?? randomUUID(),
				source: 'kingdee'
			}
		};
	});
	const authority = yield* Context.get(t.services, Identity).authority({
		actor: { kind: 'system', run: key, by: { sync: name, instance: 'kingdee' } },
		policies: [],
		admin: false
	});
	const outcome = (yield* Context.get(t.services, Writes).act({
		model,
		verb: 'upsert',
		onConflict: 'update',
		input: rows.map(({ value }) => value),
		key,
		authority,
		issuedAt: '2026-10-10T00:00:00Z',
		bindings: {
			now: '2026-10-10T00:00:00Z',
			today: '2026-10-10',
			tz: 'Asia/Singapore',
			params: {}
		},
		invocationId: key,
		mode: {
			_tag: 'Sync',
			sync: name,
			instance: 'kingdee',
			fields: [...new Set(rows.flatMap(({ value }) => Object.keys(value)))].filter(
				(field) => field !== 'id'
			),
			deletes: [],
			pieces: () => {}
		}
	})).outcome;
	if (outcome.kind === 'committed')
		for (const { identity, value } of rows) if (!ids.has(identity)) ids.set(identity, value.id);
	return outcome;
});
export const sourceOrder = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const agreement = (yield* t
		.as(t.admin)
		.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0];
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
		id: writtenId(model, yield* sync(t, model, input)),
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
		[parent.model === 'ext_sales_orders' ? 'ext_sales_order' : 'ext_purchase_order']:
			parent.id,
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
		id: writtenId('transactions', yield* sync(t, 'transactions', [input], 'upsert')),
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
		id: writtenId('source_payments', yield* sync(t, 'source_payments', [input], 'upsert')),
		input
	};
});
