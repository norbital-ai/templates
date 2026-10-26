import { Decimal } from '@norbital-ai/std/decimal';
import { decimalText, fixtureId, firstRow } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Schema, Effect, Result } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { configuredCommission } from './commission-kit.js';
import { direct, sourceOrder, sync } from './synced-kit.js';
import { businessRows } from './business-source.js';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, confirm, draft, orderRun, PRODUCT } from './kit.js';
const configuredMonthly = Effect.fnUntraced(function* () {
	let facts: Record<string, Json>[] = [];
	const setup = yield* configuredCommission();
	const addFact = Effect.fnUntraced(function* (
		own: Effect.Success<ReturnType<typeof configuredCommission>>['own'] = setup.own,
		quantity: string = '1000',
		net: string = '2000',
		code: string = 'SHIP',
		kind: string = 'shipment',
		businessOn: string = '2026-10-10'
	) {
		const order = yield* setup.as.query('orders', { id: own.order });
		facts.push({
			external_code: code,
			order_id: own.order,
			order_line_id: own.line,
			kind,
			reference: code,
			business_on: businessOn,
			source_updated_at: '2026-10-10T00:00:00Z',
			seal_hash: String(order?.seal_hash),
			unit: 'kg',
			quantity,
			currency: 'SGD',
			net_amount: net,
			tax_amount: '0',
			freight: '0',
			active: true
		});
		yield* businessRows(setup.t, 'source_sales_lines', facts);
	});
	const deactivate = Effect.fnUntraced(function* () {
		facts = facts.map((row) => ({
			...row,
			active: false,
			source_updated_at: '2026-10-11T00:00:00Z'
		}));
		yield* businessRows(setup.t, 'source_sales_lines', facts);
	});
	yield* addFact();
	return { ...setup, addFact, deactivate };
});
test.live(
	'monthly statement freezes SO proofs, retains cancelled beneficiaries and refuses stale or duplicate sign-offs',
	() =>
		Effect.gen(function* () {
			const { t, as, sales, own, deactivate } = yield* configuredMonthly();
			const finance = t.member(['finance']);
			const f = t.as(finance);
			const board = () =>
				f.query('commission_statements.board', { period: PlainDate('2026-10-10') });
			const current = firstRow(yield* board());
			expect(current).toMatchObject({
				owner: fixtureId('sys_user', sales.id),
				period: '2026-10-01',
				currency: 'SGD',
				amount: decimalText('210.00'),
				order_count: 1,
				state: 'unacknowledged'
			});
			const input = {
				owner: current.owner,
				period: current.period,
				currency: current.currency,
				calculation_hash: current.calculation_hash
			};
			expect(
				yield* Effect.flip(
					f.act('commission_statements.create', { ...input, calculation_hash: 'stale' })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const concurrent = yield* Effect.all(
				[
					f.act('commission_statements.create', input),
					f.act('commission_statements.create', input)
				],
				{ concurrency: 'unbounded', mode: 'result' }
			);
			expect(
				concurrent.filter(
					(result) => Result.isSuccess(result) && result.success.kind === 'committed'
				)
			).toHaveLength(1);
			const statements = yield* as.query('commission_statements', { all: true });
			const signedId = firstRow(statements.rows).id;
			const signed = yield* as.query('commission_statements', { id: signedId });
			expect(signed).toMatchObject({
				owner: fixtureId('sys_user', sales.id),
				amount: decimalText('210.00'),
				acknowledged_by: finance.id,
				snapshot: [{ order: own.order, amount: '210.00' }]
			});
			expect((yield* board())[0]).toMatchObject({
				state: 'current',
				latest_amount: decimalText('210.00')
			});
			const seal = yield* as.query('orders', { id: own.order });
			const counterpart = yield* sourceOrder(t, own.order);
			expect(
				yield* sync(t, counterpart.collection, { ...counterpart.input, status: 'void' }, 'upsert')
			).toMatchObject({ kind: 'committed' });
			expect(
				yield* orderRun(t, as, 'orders_cancel', {
					target: own.order,
					reason: 'Customer did not proceed'
				})
			).toMatchObject({ state: 'succeeded', output: null, error: null });
			expect((yield* board())[0]).toMatchObject({
				amount: decimalText('210.00'),
				state: 'current'
			});
			yield* deactivate();
			const changed = firstRow(yield* board());
			expect(changed).toMatchObject({
				state: 'changed',
				amount: decimalText('0.00'),
				latest_amount: decimalText('210.00'),
				order_count: 0
			});
			expect(yield* Effect.flip(f.act('commission_statements.create', input))).toMatchObject({
				_tag: 'ActRefused'
			});
			committed(
				'commission_statements',
				yield* f.act('commission_statements.create', {
					...input,
					calculation_hash: changed.calculation_hash
				})
			);
			expect((yield* board())[0]).toMatchObject({
				state: 'current',
				amount: decimalText('0.00'),
				latest_amount: decimalText('0.00')
			});
			expect(yield* as.query('commission_statements', { id: signedId })).toEqual(signed);
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				seal_hash: seal?.seal_hash,
				sealed_contract: seal?.sealed_contract
			});
			expect(
				yield* direct(t, as.authority, {
					collection: 'commission_statements',
					verb: 'update',
					input: { target: signedId, set: { amount: '999' } }
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* direct(t, as.authority, {
					collection: 'commission_statements',
					verb: 'delete',
					input: { target: signedId }
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live(
	'salesperson sees only their month and cannot sign; unknown calculations cannot be signed',
	() =>
		Effect.gen(function* () {
			const { t, as, sales, own, addFact } = yield* configuredMonthly();
			const f = t.as(t.member(['finance']));
			const current = firstRow(
				yield* f.query('commission_statements.board', { period: PlainDate('2026-10-01') })
			);
			const input = {
				owner: current.owner,
				period: current.period,
				currency: current.currency,
				calculation_hash: current.calculation_hash
			};
			expect(
				yield* Effect.flip(t.as(sales).act('commission_statements.create', input))
			).toMatchObject({
				_tag: 'ActRefused'
			});
			expect(
				yield* t
					.as(t.member(['sales']))
					.query('commission_statements.board', { period: PlainDate('2026-10-01') })
			).toEqual([]);
			expect(
				yield* t.as(sales).query('commission_statements.board', { period: PlainDate('2026-10-01') })
			).toMatchObject([{ owner: fixtureId('sys_user', sales.id), amount: decimalText('210.00') }]);
			for (const role of ['procurement', 'logistics', 'configuration'])
				yield* Effect.tryPromise({
					try: () =>
						expect(
							Effect.runPromise(
								t
									.as(t.member([role]))
									.query('commission_statements.board', { period: PlainDate('2026-10-01') })
							)
						).rejects.toThrow(),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
			const foreign = yield* draft(t, 'sales');
			yield* confirm(t, foreign.order);
			yield* addFact(foreign, '4', '8', 'FOREIGN');
			const unknown = (yield* f.query('commission_statements.board', {
				period: PlainDate('2026-10-01')
			})).find((r) => r.owner !== sales.id);
			if (unknown === undefined) throw new Error('Foreign monthly commission required');
			expect(unknown).toMatchObject({ state: 'unresolved', amount: null });
			expect(
				yield* Effect.flip(
					f.act('commission_statements.create', {
						owner: unknown.owner,
						period: unknown.period,
						currency: unknown.currency,
						calculation_hash: unknown.calculation_hash
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const record = committed(
				'commission_statements',
				yield* f.act('commission_statements.create', input)
			);
			expect(
				(yield* t.as(sales).query('commission_statements', { all: true })).rows.map((r) => r.id)
			).toEqual([record]);
			expect(
				(yield* t.as(t.member(['sales'])).query('commission_statements', { all: true })).rows
			).toEqual([]);
			expect((yield* as.query('orders', { id: own.order }))?.seal_hash).toBeTruthy();
		})
);
test.live(
	'monthly commissions use actual business dates and retain sealed factors after catalogue changes',
	() =>
		Effect.gen(function* () {
			const { t, as, sales, own, addFact, deactivate } = yield* configuredMonthly();
			yield* deactivate();
			yield* addFact(own, '400', '800', 'PARTIAL');
			const board = Effect.fnUntraced(function* () {
				return yield* as.query('commission_statements.board', { period: PlainDate('2026-10-01') });
			});
			expect((yield* board())[0]).toMatchObject({
				owner: fixtureId('sys_user', sales.id),
				amount: decimalText('84.00')
			});
			yield* addFact(own, '-100', '-200', 'RETURN', 'return');
			expect((yield* board())[0]).toMatchObject({ amount: decimalText('63.00') });
			yield* addFact(own, '100', '200', 'NEXT-MONTH', 'shipment', '2026-11-02');
			expect((yield* board())[0]).toMatchObject({ amount: decimalText('63.00') });
			expect(
				yield* as.query('commission_statements.board', { period: PlainDate('2026-11-01') })
			).toMatchObject([{ amount: decimalText('21.00') }]);
			committed(
				'products',
				yield* as.act('products.update', {
					target: PRODUCT,
					set: { commission_factor: Decimal.of('0.75') }
				})
			);
			expect((yield* board())[0]).toMatchObject({ amount: decimalText('63.00') });
			expect(
				yield* as.query('commission_statements.board', { period: PlainDate('2026-09-01') })
			).toEqual([]);
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
