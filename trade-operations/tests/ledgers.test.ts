import { fixtureId, firstRow } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Context, Effect, Layer, Schema } from 'effect';
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
		yield* t
			.as(t.admin)
			.act('sys_integration.create', [{ integration: 'kingdee', name: 'Second ledger' }])
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
					const read = (instance: typeof first) =>
						t
							.as(t.admin)
							.query({
								products: {
									where: { source: { eq: instance }, external_code: { eq: '301' } }
								}
							})
							.pipe(Effect.map((answer) => answer.products));
					const original = firstRow((yield* read(first)).rows);
					yield* t.as(t.admin).act('products.update', [
						{
							target: original.id,
							set: { commission_factor: Decimal.of('1.25'), commission_basis_unit: 'kg' }
						}
					]);
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
					expect(updated.commission_factor?.eq('1.25')).toBe(true);
					expect(firstRow((yield* read(second)).rows)).toMatchObject({
						name: 'Second resin',
						spec: 'A'
					});
					const party = firstRow(
						(yield* t.as(t.admin).query({
							parties: { where: { source: { eq: second }, external_code: { eq: '101' } } }
						})).parties.rows
					);
					const order = committed(
						'orders',
						yield* t.as(t.admin).act('orders.create', [
							{
								title: 'Mixed product',
								direction: 'sales',
								party: party.id,
								currency: 'CNY',
								payment_terms: 'PROBE-NET30'
							}
						])
					);
					expect(
						yield* Effect.flip(
							t.as(t.admin).act('order_lines.create', [
								{
									order,
									product: original.id,
									quantity: Decimal.of(1),
									unit_price: Decimal.of(2),
									discount_pct: Decimal.of(0),
									tax_rate: Decimal.of(13)
								}
							])
						)
					).toMatchObject({ _tag: 'ActRefused', message: 'errors.ledger_mismatch' });
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
								text: "SELECT status,attempts,key,error,next_attempt_at::text,result IS NOT NULL AS submitted FROM sys_outbox WHERE model='orders' AND sync='orders.sync.kingdee' AND record=$1 ORDER BY seq",
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
					const identity = yield* t.db.rows(
						Schema.Struct({ remote_id: Schema.String, remote_version: Schema.String }),
						{
							text: "SELECT remote_id,remote_version FROM sys_sync_row WHERE sync='orders.sync.kingdee' AND record=$1",
							params: [own.order]
						}
					);
					expect(identity).toEqual([
						{ remote_id: `sales:0:${9002 + before}:${own.seal}`, remote_version: own.seal }
					]);
				})
		);
	}
);
