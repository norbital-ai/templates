import { Context, Effect } from 'effect';
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
export function writtenId<C extends string>(collection: C, outcome: Outcome) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	const record = outcome.records.find((record) => record.collection === collection);
	if (record === undefined) throw new Error(`The feed committed no ${collection} record`);
	return fixtureId(collection, record.id);
}
/** Invalid and forbidden wire requests cannot be expressed by the typed caller catalogue. */
export const direct = Effect.fnUntraced(function* (
	t: T,
	authority: Authority,
	request: Pick<ActRequest, 'collection' | 'verb' | 'input'>
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
export const sync = Effect.fnUntraced(function* <
	C extends 'ext_sales_orders' | 'ext_purchase_orders' | 'transactions' | 'source_payments'
>(
	t: T,
	collection: C,
	row: Record<string, Json> | Record<string, Json>[],
	verb: 'create' | 'upsert' = 'create'
) {
	const key = randomUUID();
	const authority = yield* Context.get(t.services, Identity).authority({
		actor: {
			kind: 'system',
			run: key,
			by: { integration: 'kingdee', instance: 'kingdee', feed: collection }
		},
		policies: [],
		admin: false
	});
	return (yield* Context.get(t.services, Writes).act({
		collection,
		verb,
		input: (Array.isArray(row) ? row : [row]).map((value: Record<string, Json>) => ({
			...value,
			source: 'kingdee'
		})),
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
		...(verb === 'upsert' ? { onConflict: 'update' as const } : {}),
		mode: {
			_tag: 'Feed',
			fields: [...Object.keys((Array.isArray(row) ? row[0] : row) ?? {}), 'source'],
			removals: [],
			pieces: () => {}
		}
	})).outcome;
});
export const sourceOrder = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const agreement = yield* t.as(t.admin).get('orders', order);
	if (typeof agreement?.seal_hash !== 'string' || typeof agreement.currency !== 'string')
		throw new Error('Sealed agreement required');
	const collection: 'ext_sales_orders' | 'ext_purchase_orders' =
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
		id: writtenId(collection, yield* sync(t, collection, input)),
		collection,
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
	quantity = '4',
	overrides: Record<string, Json> = {}
) {
	const input = {
		erp_id: randomUUID(),
		order: own.order,
		[parent.collection === 'ext_sales_orders' ? 'ext_sales_order' : 'ext_purchase_order']:
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
	reference = randomUUID(),
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
