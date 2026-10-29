import { decimalText, fixtureId, firstRow } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result } from 'effect';
import { expect, it } from '@effect/vitest';
import { commissionRule, commissionSale } from './commission-kit.js';
import { direct } from './synced-kit.js';
import { businessRows } from './business-source.js';
import { committed, workspace } from './kit.js';
import { boardOf } from './reads.js';
it.live(
	"monthly statement freezes the calculation, is the owner's alone, and refuses stale or duplicate sign-offs",
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			yield* commissionRule(t);
			const { sales, own } = yield* commissionSale(t);
			const as = t.as(t.admin);
			const seal_hash = String(
				(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
					?.seal_hash
			);
			const fact = (active: boolean, source_updated_at: string) =>
				businessRows(t, 'source_sales_lines', [
					{
						external_code: 'SHIP',
						order_id: own.order,
						order_line_id: own.line,
						kind: 'shipment',
						reference: 'SHIP',
						business_on: '2026-10-10',
						source_updated_at,
						seal_hash,
						unit: 'kg',
						quantity: '1000',
						currency: 'SGD',
						net_amount: '2000',
						tax_amount: '0',
						freight: '0',
						active
					}
				]);
			yield* fact(true, '2026-10-10T00:00:00Z');
			const finance = t.member(['finance']);
			const f = t.as(finance);
			const board = () => boardOf(f, { period: PlainDate('2026-10-10') });
			const current = firstRow(yield* board());
			expect(current).toMatchObject({
				owner: fixtureId('sys_user', sales.id),
				period: '2026-10-01',
				currency: 'SGD',
				amount: decimalText('210.00'),
				order_count: 1,
				state: 'unacknowledged'
			});
			expect(yield* boardOf(t.as(sales), { period: PlainDate('2026-10-01') })).toMatchObject([
				{ owner: fixtureId('sys_user', sales.id), amount: decimalText('210.00') }
			]);
			expect(
				yield* boardOf(t.as(t.member(['sales'])), { period: PlainDate('2026-10-01') })
			).toEqual([]);
			const input = {
				owner: current.owner,
				period: current.period,
				currency: current.currency,
				calculation_hash: current.calculation_hash
			};
			expect(
				yield* Effect.flip(t.as(sales).act('commission_statements.create', [input]))
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					f.act('commission_statements.create', [{ ...input, calculation_hash: 'stale' }])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const concurrent = yield* Effect.all(
				[
					f.act('commission_statements.create', [input]),
					f.act('commission_statements.create', [input])
				],
				{ concurrency: 'unbounded', mode: 'result' }
			);
			const signed = concurrent.flatMap((result) =>
				Result.isSuccess(result) && result.success.kind === 'committed'
					? [committed('commission_statements', result.success)]
					: []
			);
			expect(signed).toHaveLength(1);
			const [signedId] = signed;
			if (signedId === undefined) throw new Error('Signed statement required');
			const statement = (yield* as.query({
				commission_statements: { where: { id: { eq: signedId } }, limit: 1 }
			})).commission_statements.rows[0];
			expect(statement).toMatchObject({
				amount: decimalText('210.00'),
				acknowledged_by: finance.id,
				snapshot: [{ order: own.order, amount: '210.00' }]
			});
			expect((yield* board())[0]).toMatchObject({ state: 'current' });
			yield* fact(false, '2026-10-11T00:00:00Z');
			const changed = firstRow(yield* board());
			expect(changed).toMatchObject({
				state: 'changed',
				amount: decimalText('0.00'),
				latest_amount: decimalText('210.00'),
				order_count: 0
			});
			expect(yield* Effect.flip(f.act('commission_statements.create', [input]))).toMatchObject({
				_tag: 'ActRefused'
			});
			committed(
				'commission_statements',
				yield* f.act('commission_statements.create', [
					{ ...input, calculation_hash: changed.calculation_hash }
				])
			);
			expect((yield* board())[0]).toMatchObject({ state: 'current', amount: decimalText('0.00') });
			expect(
				(yield* as.query({ commission_statements: { where: { id: { eq: signedId } }, limit: 1 } }))
					.commission_statements.rows[0]
			).toEqual(statement);
			expect(
				yield* direct(t, as.authority, {
					model: 'commission_statements',
					verb: 'update',
					input: [{ target: signedId, set: { amount: '999' } }]
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
