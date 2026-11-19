import type { Id, Row, ModelName } from '@norbital-ai/bolt';
import { type NativeActAnswer, type TestOptions, type TestPorts } from '@norbital-ai/bolt-cli/test';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import { Context, Effect, Layer, Schema } from 'effect';
import { DatabaseRequest, type DatabaseResult, type BoltError } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
export const CUSTOMER = fixtureId('parties', '00000000-0000-4000-8000-000000000101');
export const SUPPLIER = fixtureId('parties', '00000000-0000-4000-8000-000000000102');
export const PRODUCT = fixtureId('products', '00000000-0000-4000-8000-000000000201');
export const SETTINGS = fixtureId('commercial_settings', '00000000-0000-4000-8000-000000000401');
/** The test pack's Kingdee settlement methods (`seed/test/settlements.json`), by code. */
export const NET30 = fixtureId('settlements', '00000000-0000-4000-8000-000000000501');
export const NET60 = fixtureId('settlements', '00000000-0000-4000-8000-000000000502');
export const PROBE_NET30 = fixtureId('settlements', '00000000-0000-4000-8000-000000000503');
export const PROBE_NET60 = fixtureId('settlements', '00000000-0000-4000-8000-000000000504');
export function committed<C extends ModelName>(model: C, outcome: NativeActAnswer) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	const record = outcome.records.find((record) => record.model === model);
	if (record === undefined) throw new Error('The act committed no record');
	return fixtureId(model, record.id);
}
/** The models the `kingdee` sync reads. */
export type Synced =
	| 'orders'
	| 'order_lines'
	| 'parties'
	| 'products'
	| 'warehouses'
	| 'settlements'
	| 'contacts'
	| 'stock_snapshots'
	| 'source_stock_commitments'
	| 'source_lot_costs'
	| 'credit_snapshots'
	| 'transactions'
	| 'source_payments'
	| 'source_sales_lines';
export const workspace = Effect.fnUntraced(function* <P extends TestPorts = never>(
	over: Extract<TestOptions<P>, { artifact?: never }> & {
		source?: (op: DatabaseRequest) => Effect.Effect<DatabaseResult, FacilityFailure | BoltError>;
	} = {}
) {
	const { source, ...options } = over;
	const t = yield* acquireWorkspace({
		root: process.cwd(),
		now: '2026-10-10T00:00:00Z',
		...options
	});
	// the host marks a ledger connected once its SQL test passes; a seed carries no status, so the kit does
	yield* t.db.write({
		text: `UPDATE sys_integration SET status = '{"state":"connected","databaseVerified":true}'::jsonb WHERE integration = 'kingdee'`,
		params: []
	});
	if (source !== undefined)
		t.fakes.links.answer = (_instance, op) =>
			Schema.decodeUnknownEffect(DatabaseRequest)(op).pipe(
				Effect.mapError(
					(cause) => new FacilityFailure({ kind: 'invalid', message: String(cause) })
				),
				Effect.flatMap((request) =>
					source(request).pipe(
						Effect.mapError((cause) =>
							cause instanceof FacilityFailure
								? cause
								: new FacilityFailure({ kind: 'upstream', message: String(cause) })
						)
					)
				)
			);
	return {
		...t,
		/** One run of the model's `kingdee` sync read for an instance: every page while `more`, failures surfaced. */
		pull: (model: Synced, instance: string = 'kingdee') =>
			t.syncs.read(`${model}.sync.kingdee`, { instance }),
		/** One pass over the due sync writes (the `orders` submissions). */
		deliver: () => t.syncs.deliver()
	};
});
export type T = Effect.Success<ReturnType<typeof workspace>>;
/** The workspace a file's tests share: `layer(shared(...), { excludeTestServices: true })`, then `yield* Trade`. */
export class Trade extends Context.Service<Trade, T>()('trade-operations/Trade') {}
export const shared = <P extends TestPorts = never>(
	options: Parameters<typeof workspace<P>>[0] = {}
) => Layer.effect(Trade, workspace(options));
export const draft = Effect.fnUntraced(function* (
	t: T,
	direction: Row<'orders'>['direction'] = 'sales',
	owner?: Id<'sys_user'>,
	ordered_on?: string,
	warehouse?: Id<'warehouses'>
) {
	const as = yield* t.as(t.admin);
	const order = committed(
		'orders',
		yield* as.act({
			'orders.create': [
				{
					title: 'Sample order',
					direction,
					party: direction === 'sales' ? CUSTOMER : SUPPLIER,
					currency: 'SGD',
					payment_terms: NET30,
					...(owner ? { owner } : {}),
					...(warehouse ? { warehouse } : {}),
					...(ordered_on ? { ordered_on: ordered_on } : {})
				}
			]
		})
	);
	const line = committed(
		'order_lines',
		yield* as.act({
			'order_lines.create': [
				{
					order,
					product: PRODUCT,
					quantity: '10',
					unit_price: '2',
					discount_pct: '0',
					tax_rate: '9'
				}
			]
		})
	);
	return { order, line };
});
/** Syncs a saved draft to Kingdee, once: from then on the order and its SO or PO stay in step. */
export const confirm = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const as = yield* t.as(t.admin);
	return committed(
		'orders',
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }]
		})
	);
});
