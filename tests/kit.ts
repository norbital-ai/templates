import type { Committed, PendingApproval, Id, Row, CollectionName } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';
import { PlainDate, Instant } from '@norbital-ai/std/date';
import { type TestOptions, type TestPorts } from '@norbital-ai/bolt/test';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import { Effect, Schema } from 'effect';
import { DatabaseRequest, type DatabaseResult, type BoltError } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
export const CUSTOMER = fixtureId('parties', '00000000-0000-4000-8000-000000000101');
export const SUPPLIER = fixtureId('parties', '00000000-0000-4000-8000-000000000102');
export const PRODUCT = fixtureId('products', '00000000-0000-4000-8000-000000000201');
export const SETTINGS = fixtureId('commercial_settings', '00000000-0000-4000-8000-000000000401');
export function committed<C extends CollectionName, O, N extends string>(
	collection: C,
	outcome: Committed<O, N> | PendingApproval<N>
) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	const record = outcome.records.find((record) => record.collection === collection);
	if (record === undefined) throw new Error('The act committed no record');
	return fixtureId(collection, record.id);
}
/** The models the `kingdee` sync reads. */
export type Synced =
	| 'orders'
	| 'parties'
	| 'products'
	| 'warehouses'
	| 'stock_snapshots'
	| 'credit_snapshots'
	| 'ext_sales_orders'
	| 'ext_purchase_orders'
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
		seed: 'base',
		...options
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
export const draft = Effect.fnUntraced(function* (
	t: T,
	direction: Row<'orders'>['direction'] = 'sales',
	owner?: Id<'sys_user'>,
	ordered_on?: string,
	warehouse?: Id<'warehouses'>
) {
	const as = t.as(t.admin);
	const order = committed(
		'orders',
		yield* as.act('orders.create', {
			title: 'Sample order',
			direction,
			party: direction === 'sales' ? CUSTOMER : SUPPLIER,
			currency: 'SGD',
			payment_terms: 'Net 30',
			...(owner ? { owner } : {}),
			...(warehouse ? { warehouse } : {}),
			...(ordered_on ? { ordered_on: PlainDate(ordered_on) } : {})
		})
	);
	const line = committed(
		'order_lines',
		yield* as.act('order_lines.create', {
			order,
			product: PRODUCT,
			quantity: Decimal.of('10'),
			unit_price: Decimal.of('2'),
			discount_pct: Decimal.of('0'),
			tax_rate: Decimal.of('9')
		})
	);
	return { order, line };
});
export const confirm = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const check = yield* t
		.as(t.admin)
		.query('orders.confirmation_check', { as_of: Instant(t.clock.now()), order });
	return committed(
		'orders',
		yield* t.as(t.admin).act('orders.update', {
			target: order,
			set: { status: 'confirmed', check_hash: check.check_hash }
		})
	);
});

/** Start a replacement draft without mutating the current sealed contract. */
export const revise = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const as = t.as(t.admin);
	const before = yield* as.query('orders', { id: order });
	if (!before) throw new Error('Current contract required');
	const started = yield* as.start('orders_revise', { target: order, revision: before.revision });
	if (started.kind !== 'committed') throw new Error('Replacement must be admitted directly');
	yield* t.runDue();
	const [run] = yield* t.db.rows(
		Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.Json) }),
		{
			text: 'SELECT state, error FROM sys_run WHERE id = $1',
			params: [started.output.id]
		}
	);
	if (run?.state !== 'succeeded') throw new Error(JSON.stringify(run));
	return order;
});
