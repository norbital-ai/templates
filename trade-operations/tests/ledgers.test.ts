import { fixtureId, firstRow, sameDecimal } from './test-runtime.js';
import { Context, Effect, Exit, Layer, Schema } from 'effect';
import { expect, layer } from '@effect/vitest';
import { DatabaseRequest, type DatabaseResult } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { committed, workspace } from './kit.js';
import { kingdeeCatalogue, kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';

const first = fixtureId('sys_integration', 'kingdee');
type Source = (request: DatabaseRequest) => Effect.Effect<DatabaseResult, FacilityFailure>;
/** Two Kingdee ledgers over one workspace; `routes` answers each integration instance. */
const ledgers = Effect.fnUntraced(function* () {
	const records = { first: kingdeeCatalogue('First'), second: kingdeeCatalogue('Second') };
	const sources = {
		first: kingdeeFixture(() => records.first),
		second: kingdeeFixture(() => records.second)
	};
	const t = yield* workspace();
	const second = committed(
		'sys_integration',
		yield* (yield* t.as(t.admin)).act({
			'sys_integration.create': [{ integration: 'kingdee', name: 'Second ledger' }]
		})
	);
	const routes = new Map<string, Source>([
		[first, sources.first.request],
		[second, sources.second.request]
	]);
	t.fakes.links.answer = (instance, operation) =>
		Schema.decodeUnknownEffect(DatabaseRequest)(operation).pipe(
			Effect.mapError((cause) => new FacilityFailure({ kind: 'invalid', message: String(cause) })),
			Effect.flatMap(
				(request) =>
					routes.get(instance)?.(request) ??
					Effect.fail(new FacilityFailure({ kind: 'invalid', message: 'Unknown ledger' }))
			)
		);
	return { t, second, records, sources, routes };
});
class Ledgers extends Context.Service<Ledgers, Effect.Success<ReturnType<typeof ledgers>>>()(
	'trade-operations/Ledgers'
) {}

layer(Layer.effect(Ledgers, ledgers()), { excludeTestServices: true })(
	'kingdee ledgers',
	(test) => {
		test.effect(
			'a physical source edit updates only its ledger, keeps local product settings, and orders cannot mix ledgers',
			() =>
				Effect.gen(function* () {
					const { t, second, records } = yield* Ledgers;
					yield* t.pull('products', first);
					yield* t.pull('products', second);
					yield* t.pull('parties', second);
					const admin = yield* t.as(t.admin);
					const read = (instance: typeof first) =>
						admin
							.query({
								products: {
									where: { source: { eq: instance }, external_code: { eq: '301' } }
								}
							})
							.pipe(Effect.map((answer) => answer.products));
					const original = firstRow((yield* read(first)).rows);
					yield* (yield* t.as(t.admin)).act({
						'products.update': [
							{
								target: yield* t.at('products', original.id),
								set: { commission_factor: '1.25', commission_basis_unit: 'kg' }
							}
						]
					});
					records.first['/products'] = (records.first['/products'] ?? []).map((row) => {
						return {
							...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row),
							spec: 'Changed source grade'
						};
					});
					yield* t.pull('products', first);
					const updated = firstRow((yield* read(first)).rows);
					expect(updated).toMatchObject({
						id: original.id,
						spec: 'Changed source grade',
						commission_basis_unit: 'kg'
					});
					expect(sameDecimal(updated.commission_factor, '1.25')).toBe(true);
					expect(firstRow((yield* read(second)).rows)).toMatchObject({
						name: 'Second resin',
						spec: 'A'
					});
					const party = firstRow(
						(yield* (yield* t.as(t.admin)).query({
							parties: { where: { source: { eq: second }, external_code: { eq: '101' } } }
						})).parties.rows
					);
					const order = committed(
						'orders',
						yield* (yield* t.as(t.admin)).act({
							'orders.create': [
								{
									title: 'Mixed product',
									direction: 'sales',
									party: party.id,
									currency: 'CNY',
									payment_terms: 'PROBE-NET30'
								}
							]
						})
					);
					expect(
						yield* Effect.flip(
							(yield* t.as(t.admin)).act({
								'order_lines.create': [
									{
										order,
										product: original.id,
										quantity: '1',
										unit_price: '2',
										discount_pct: '0',
										tax_rate: '13'
									}
								]
							})
						)
					).toMatchObject({ _tag: 'ActRefused', key: 'errors.ledger_mismatch' });
				})
		);

		test.effect('a failing ledger leaves the other ledger readable and reports the failure', () =>
			Effect.gen(function* () {
				const { t, second, routes } = yield* Ledgers;
				yield* t.pull('products', first);
				yield* t.pull('products', second);
				const before = firstRow(
					yield* t.db.rows(
						Schema.Struct({
							cursor: Schema.NullOr(Schema.Json),
							health: Schema.NullOr(Schema.Json)
						}),
						{
							text: "SELECT cursor, health FROM sys_sync WHERE sync='products.sync.kingdee' AND instance=$1",
							params: [second]
						}
					)
				);
				routes.set(String(second), () =>
					Effect.fail(new FacilityFailure({ kind: 'upstream', message: 'Second ledger offline' }))
				);
				expect(Exit.isFailure(yield* Effect.exit(t.pull('products', second)))).toBe(true);
				expect(Exit.isSuccess(yield* Effect.exit(t.pull('products', first)))).toBe(true);
				expect(
					firstRow(
						yield* t.db.rows(
							Schema.Struct({
								cursor: Schema.NullOr(Schema.Json),
								health: Schema.NullOr(Schema.Json)
							}),
							{
								text: "SELECT cursor, health FROM sys_sync WHERE sync='products.sync.kingdee' AND instance=$1",
								params: [second]
							}
						)
					)
				).toMatchObject({
					cursor: before?.cursor,
					health: { state: 'attention', failures: 1, code: 'guest_error' }
				});
				const products = yield* (yield* t.as(t.admin)).query({
					products: { where: { source: { eq: first } }, fields: ['name'] }
				});
				expect(products.products.rows.length).toBeGreaterThan(0);
			})
		);

		test.effect(
			'a committed write with a lost receipt converges to one acknowledged ERP order',
			() =>
				Effect.gen(function* () {
					const { t, sources } = yield* Ledgers;
					const fixture = sources.first;
					const before = fixture.submissions.size;
					const own = yield* kingdeeSale(t, fixture, first);
					fixture.state.loseNextReceipt = true;
					const Outbox = Schema.Struct({
						status: Schema.String,
						attempts: Schema.Number,
						key: Schema.String,
						error: Schema.NullOr(Schema.Json),
						next_attempt_at: Schema.String,
						submitted: Schema.Boolean
					});
					const state = Effect.fnUntraced(function* () {
						return firstRow(
							yield* t.db.rows(Outbox, {
								text: "SELECT status,attempts,key,error,next_attempt_at::text,result IS NOT NULL AS submitted FROM sys_outbox WHERE model='orders' AND sync='orders.sync.kingdee' AND record=$1 ORDER BY seq DESC",
								params: [own.order]
							})
						);
					});
					const originalKey = (yield* state()).key;
					yield* t.deliver();
					const queued = yield* state();
					expect(queued).toMatchObject({
						status: 'queued',
						attempts: 1,
						key: originalKey,
						submitted: false
					});
					expect(fixture.submissions.size).toBe(before + 1);
					const sync = Effect.fnUntraced(function* () {
						return (yield* (yield* t.as(t.admin)).query({
							orders: { where: { id: { eq: own.order } }, limit: 1 }
						})).orders.rows[0]?.$sync?.kingdee?.status;
					});
					expect(yield* sync()).toBe('pending');
					t.clock.set(new Date(queued.next_attempt_at).toISOString());
					yield* t.deliver();
					expect(yield* state()).toMatchObject({
						status: 'acked',
						attempts: 2,
						key: originalKey,
						error: null,
						submitted: true
					});
					expect(fixture.submissions.size).toBe(before + 1);
					expect(fixture.state.lostReceipts).toBe(1);
					expect(yield* sync()).toBe('ok');
					const identity = yield* t.db.rows(
						Schema.Struct({
							remote_id: Schema.String,
							remote_version: Schema.NullOr(Schema.String)
						}),
						{
							text: "SELECT remote_id,remote_version FROM sys_sync_row WHERE sync='orders.sync.kingdee' AND record=$1",
							params: [own.order]
						}
					);
					const key = (yield* (yield* t.as(t.admin)).query({
						orders: { where: { id: { eq: own.order } }, limit: 1 }
					})).orders.rows[0]?.source_order_key;
					expect(identity).toMatchObject([
						{
							remote_id: `sales:0:${9002 + before}:${key}`,
							// the ack carries no version: the next read brings the SO's own state back
							remote_version: null
						}
					]);
				})
		);
	}
);
