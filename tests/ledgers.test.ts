import { fixtureId, firstRow } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { DatabaseRequest } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { committed, confirm, workspace, type Synced } from './kit.js';
import { sourceFixture } from './source-fixture.js';
import {
	kingdeeCatalogue,
	kingdeeDraft,
	kingdeeFixture,
	kingdeeSale,
	stockKey
} from './kingdee-fixture.js';
import { quotationOf } from './reads.js';

const first = fixtureId('sys_integration', 'kingdee');
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
	t.fakes.links.answer = (instance, operation) =>
		Schema.decodeUnknownEffect(DatabaseRequest)(operation).pipe(
			Effect.mapError((cause) => new FacilityFailure({ kind: 'invalid', message: String(cause) })),
			Effect.flatMap((request) =>
				instance === first
					? sources.first.request(request)
					: instance === second
						? sources.second.request(request)
						: Effect.fail(new FacilityFailure({ kind: 'invalid', message: 'Unknown ledger' }))
			)
		);
	const pull = Effect.fnUntraced(function* (model: Synced) {
		yield* t.pull(model, first);
		yield* t.pull(model, second);
	});
	return { t, second, records, sources, pull };
});

test.live('identical Kingdee item IDs resolve stock references within their own ledger', () =>
	Effect.gen(function* () {
		const { t, second, records, pull } = yield* ledgers();
		const key = stockKey('301', '502', 'LOT-A');
		for (const [ledger, amount] of [
			['first', '100'],
			['second', '7']
		] as const)
			records[ledger]['/stock_snapshots'] = [
				{
					__key: key,
					item_id: '301',
					warehouse_id: '502',
					lot_number: 'LOT-A',
					unit: 'kg',
					on_hand: amount
				}
			];
		for (const model of ['parties', 'products', 'warehouses', 'stock_snapshots'] as const)
			yield* pull(model);
		for (const [instance, amount, name] of [
			[first, '100', 'First resin'],
			[second, '7', 'Second resin']
		] as const) {
			const stocks = (yield* t
				.as(t.admin)
				.query({ stock_snapshots: { where: { source: { eq: instance } } } })).stock_snapshots;
			expect(stocks.rows).toHaveLength(1);
			const stock = firstRow(stocks.rows);
			expect(stock.on_hand.eq(amount)).toBe(true);
			expect(stock.currency).toBeNull();
			expect(stock.unit_cost).toBeNull();
			expect(
				(yield* t
					.as(t.admin)
					.query({ products: { where: { id: { eq: stock.product } }, limit: 1 } })).products.rows[0]
			).toMatchObject({
				source: instance,
				external_code: '301',
				name
			});
			expect(
				(yield* t
					.as(t.admin)
					.query({ warehouses: { where: { id: { eq: stock.warehouse } }, limit: 1 } })).warehouses
					.rows[0]
			).toMatchObject({
				source: instance,
				external_code: '502'
			});
		}
	})
);

test.live(
	'a physical source edit updates only its ledger and preserves local product settings',
	() =>
		Effect.gen(function* () {
			const { t, second, records, pull } = yield* ledgers();
			yield* pull('products');
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
		})
);

test.live(
	'a confirmed sale is submitted once to its own ledger and the same ERP integer IDs remain separate',
	() =>
		Effect.gen(function* () {
			const { t, second, sources } = yield* ledgers();
			const firstSale = yield* kingdeeSale(t, sources.first, first);
			const secondSale = yield* kingdeeSale(t, sources.second, second);
			expect(yield* t.deliver()).toMatchObject({ delivered: 2 });
			expect(sources.first.submissions.size).toBe(1);
			expect(sources.second.submissions.size).toBe(1);
			expect(firstRow([...sources.first.submissions.values()]).remote).toBe('9002');
			expect(firstRow([...sources.second.submissions.values()]).remote).toBe('9002');
			expect(yield* t.deliver()).toMatchObject({ delivered: 0 });
			for (const [instance, own] of [
				[first, firstSale],
				[second, secondSale]
			] as const) {
				yield* t.pull('ext_sales_orders', instance);
				const parent = firstRow(
					(yield* t
						.as(t.admin)
						.query({ ext_sales_orders: { where: { source: { eq: instance } } } })).ext_sales_orders
						.rows
				);
				expect(parent).toMatchObject({
					source: instance,
					order: own.order,
					agreement_hash: own.seal,
					status: 'draft'
				});
				expect(parent.external_id).toBe(`sales:0:9002:${own.seal}`);
			}
			const mixedParty = firstRow(
				(yield* t.as(t.admin).query({
					parties: {
						where: { source: { eq: second }, external_code: { eq: '101' } }
					}
				})).parties.rows
			);
			expect(
				yield* Effect.flip(
					t.as(t.admin).act('orders.create', [
						{
							title: 'Mixed warehouse',
							direction: 'sales',
							party: mixedParty.id,
							warehouse: firstSale.warehouse,
							currency: 'CNY',
							payment_terms: 'PROBE-NET30'
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused', message: 'errors.ledger_mismatch' });
			const mixedOrder = committed(
				'orders',
				yield* t.as(t.admin).act('orders.create', [
					{
						title: 'Mixed product',
						direction: 'sales',
						party: mixedParty.id,
						currency: 'CNY',
						payment_terms: 'PROBE-NET30'
					}
				])
			);
			expect(
				yield* Effect.flip(
					t.as(t.admin).act('order_lines.create', [
						{
							order: mixedOrder,
							product: firstSale.product,
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

test.live(
	'source outages and a committed write with a lost receipt converge to one acknowledged ERP order',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const own = yield* kingdeeSale(t, fixture);
			fixture.state.unreachable = 2;
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
			for (let attempt = 1; attempt <= 3; attempt++) {
				expect(yield* t.deliver()).toMatchObject({ delivered: 1 });
				const queued = yield* state();
				expect(queued).toMatchObject({
					status: 'queued',
					attempts: attempt,
					key: originalKey,
					submitted: false
				});
				expect(queued.error).not.toBeNull();
				expect(fixture.submissions.size).toBe(attempt < 3 ? 0 : 1);
				t.clock.set(new Date(queued.next_attempt_at).toISOString());
			}
			expect(yield* t.deliver()).toMatchObject({ delivered: 1 });
			expect(yield* state()).toMatchObject({
				status: 'acked',
				attempts: 4,
				key: originalKey,
				error: null,
				submitted: true
			});
			expect(fixture.submissions.size).toBe(1);
			expect(fixture.state.lostReceipts).toBe(1);
			const identity = yield* t.db.rows(
				Schema.Struct({ remote_id: Schema.String, remote_version: Schema.String }),
				{
					text: "SELECT remote_id,remote_version FROM sys_sync_row WHERE sync='orders.sync.kingdee' AND record=$1",
					params: [own.order]
				}
			);
			expect(identity).toEqual([
				{ remote_id: `sales:0:9002:${own.seal}`, remote_version: own.seal }
			]);
			t.clock.advance('10min');
			expect(yield* t.deliver()).toMatchObject({ delivered: 0 });
		})
);

test.live(
	'draft quotations make no provider call and only the first confirmed sale is submitted',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const own = yield* kingdeeDraft(t, fixture);
			const calls = fixture.calls.length;
			yield* t.deliver();
			expect(fixture.calls).toHaveLength(calls);
			expect(fixture.submissions.size).toBe(0);
			expect(
				(yield* quotationOf(t.as(t.admin), { order: own.order })).contract.length
			).toBeGreaterThan(20);
			yield* confirm(t, own.order);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(1);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(1);
		})
);

test.live('a ledger needing attention notifies configuration holders once', () =>
	Effect.gen(function* () {
		const fixture = sourceFixture(() => ({ '/parties': [] }));
		let clocks = 0;
		const t = yield* workspace({
			source: Effect.fnUntraced(function* (operation: DatabaseRequest) {
				const answer = yield* fixture(operation);
				return operation.op === 'call' &&
					typeof operation.arguments.stmt === 'string' &&
					operation.arguments.stmt.includes('MIN_ACTIVE_ROWVERSION')
					? {
							rows: answer.rows.map((row) => ({
								...row,
								observed_at:
									clocks++ === 0 ? '2026-10-10T00:00:00.000Z' : '2026-10-10T00:16:00.000Z'
							}))
						}
					: answer;
			})
		});
		const configurator = t.member(['configuration'], {
			teams: ['configurators'],
			teamPath: ['configurators']
		});
		const sales = t.member(['sales'], { teams: ['sales'], teamPath: ['sales'] });
		yield* t.pull('parties');
		expect(
			(yield* t.as(t.admin).query({ sys_integration: { where: { id: { eq: first } }, limit: 1 } }))
				.sys_integration.rows[0]
		).toMatchObject({
			status: { health: { state: 'attention', code: 'windowLag' } }
		});
		yield* t.runDue();
		yield* t.pull('parties');
		yield* t.runDue();
		const inbox = (member: string) =>
			t.db.rows(Schema.Struct({ title: Schema.String, body: Schema.String }), {
				text: 'SELECT title,body FROM sys_notification WHERE member=$1',
				params: [member]
			});
		expect(yield* inbox(configurator.id)).toEqual([
			{
				title: 'kingdee needs attention',
				body: 'An accounting source window is taking longer than the configured limit.'
			}
		]);
		expect(yield* inbox(sales.id)).toEqual([]);
	})
);
