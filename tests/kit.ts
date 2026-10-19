import type { Committed, PendingApproval, Id, Row, CollectionName } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { randomUUID } from 'node:crypto';
import { type TestOptions, type TestPorts } from '@norbital-ai/bolt/test';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import { Context, Effect, Schema } from 'effect';
import {
	DatabaseRequest,
	Feeds,
	Outbound,
	type DatabaseResult,
	type BoltError
} from '@norbital-ai/bolt/engine';
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
	const feeds = Context.get(t.services, Feeds),
		outbound = Context.get(t.services, Outbound);
	return {
		...t,
		pull: (collection: string, id: string = randomUUID(), instance = 'kingdee') => {
			const handler = feeds.handlers[`kingdee.${collection}`];
			if (handler === undefined) return Effect.die(new Error(`Missing feed kingdee.${collection}`));
			return handler({ instance }, { id, starter: null }).pipe(Effect.provide(t.services));
		},
		deliver: () => outbound.deliver.pipe(Effect.provide(t.services))
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
	const check = yield* t.as(t.admin).query('orders.confirmation_check', { order });
	return committed(
		'orders',
		yield* t.as(t.admin).act('orders.update', {
			target: order,
			set: { status: 'confirmed', check_hash: check.check_hash }
		})
	);
});
