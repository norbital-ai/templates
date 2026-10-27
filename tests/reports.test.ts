import { fixtureId, decimalText } from './test-runtime.js';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { sourceOrder, sourceTransaction, sourcePayment } from './synced-kit.js';
import { expect, it as test } from '@effect/vitest';
import { committed, workspace, draft, confirm, PRODUCT } from './kit.js';
import { agreements } from '../src/lib/agreements.js';
import { commissionCalculation, commissionRows, type CommissionFact } from '../src/lib/reports.js';
import { agingOf, commissionOf } from './reads.js';
test.live(
	'AR separates applied payments, unapplied deposits, overdue buckets and overpayments',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const as = t.as(t.admin);
			const parent = yield* sourceOrder(t, order);
			const invoice = yield* sourceTransaction(t, { order, line }, parent);
			yield* sourcePayment(t, parent, invoice.id, '5');
			yield* sourcePayment(t, parent, null, '3');
			expect(yield* agingOf(as, { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('16.80'), bucket: '61_90', overpaid: decimalText('0') }
			]);
			yield* sourcePayment(t, parent, invoice.id, '20');
			committed(
				'orders',
				yield* as.act('orders.update', [{ target: order, set: { archived: true } }])
			);
			expect(yield* agingOf(as, { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('0'), overpaid: decimalText('3.20') }
			]);
		})
);
test.live(
	'commission keeps its SO-sealed floor, rule and conversion when configuration changes',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const rule = committed(
				'commission_rules',
				yield* as.act('commission_rules.create', [
					{
						code: 'default',
						currency: 'SGD',
						effective_on: PlainDate('2026-01-01'),
						basis_unit: 't',
						fixed_rate: Decimal.of('10'),
						spread_pct: Decimal.of('20')
					}
				])
			);
			const floor = committed(
				'pricing_floors',
				yield* as.act('pricing_floors.create', [
					{
						product: PRODUCT,
						currency: 'SGD',
						group_code: 'WEST',
						effective_on: PlainDate('2026-01-01'),
						unit: 'kg',
						floor_price: Decimal.of('1'),
						tax_inclusive: false
					}
				])
			);
			const { order, line } = yield* draft(t);
			committed('order_lines', yield* as.act('order_lines.delete', [{ target: line }]));
			committed(
				'orders',
				yield* as.act('orders.update', [
					{
						target: order,
						set: { warehouse: fixtureId('warehouses', '00000000-0000-4000-8000-000000000301') }
					}
				])
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.create', [
					{
						order,
						product: PRODUCT,
						quantity: Decimal.of('1000'),
						unit_price: Decimal.of('2'),
						discount_pct: Decimal.of('0'),
						tax_rate: Decimal.of('9')
					}
				])
			);
			yield* confirm(t, order);
			const before = yield* commissionOf(as, {});
			expect(before).toMatchObject([
				{ reason: 'resolved', amount: decimalText('210.00'), spread: decimalText('1000.00000000') }
			]);
			const record = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
				.orders.rows[0];
			if (!record) throw new Error('Sealed order required');
			const current = agreements(record)[0];
			if (!current) throw new Error('Current contract required');
			const pending = {
				...current,
				version: 2,
				seal_hash: 'replacement-pending',
				lifecycle: 'pending' as const,
				snapshot: {
					...current.snapshot,
					lines: current.snapshot.lines.map((line) => ({
						...line,
						unit_price: '3',
						net: '3000',
						tax: '270',
						total: '3270'
					})),
					net: '3000',
					tax: '270',
					total: '3270'
				}
			};
			const replacement = {
				...record,
				contract_versions: [{ ...current, lifecycle: 'current' as const }, pending]
			};
			expect(commissionRows([replacement]).map((row) => row.amount?.toString())).toEqual([
				'210.00'
			]);
			expect(commissionRows([replacement], 1).map((row) => row.amount?.toString())).toEqual([
				'210.00'
			]);
			expect(
				commissionRows([
					{ ...record, contract_versions: [{ ...current, lifecycle: 'pending' as const }] }
				])
			).toEqual([]);
			const voided = {
				...record,
				contract_versions: [
					{
						...current,
						lifecycle: 'current' as const,
						kingdee: {
							branch: '0',
							source_id: '34135',
							live_source_id: '34135',
							source_version: '000',
							source_uuid: '00000000-0000-4000-8000-000000034135',
							observed_at: Instant(t.clock.now()),
							content_hash: 'retained-source-terms',
							archived: false,
							status: 'void' as const,
							closed: false
						}
					}
				]
			};
			expect(commissionRows([voided])).toEqual([]);
			const sealedLine = current.snapshot.lines[0];
			if (!sealedLine) throw new Error('Sealed commission line required');
			const fact: CommissionFact = {
				id: fixtureId('source_sales_lines', '00000000-0000-4000-8000-000000000999'),
				order,
				seal_hash: current.seal_hash,
				order_line: sealedLine.id,
				kind: 'shipment',
				unit: 'kg',
				quantity: Decimal.of('1000'),
				currency: 'SGD',
				net_amount: Decimal.of('2000'),
				active: true,
				business_on: PlainDate('2026-10-10')
			};
			expect(yield* commissionCalculation(voided, current.seal_hash, [fact])).toMatchObject({
				amount: decimalText('210.00'),
				snapshot: { eligible: true }
			});
			committed(
				'commission_rules',
				yield* as.act('commission_rules.update', [
					{
						target: rule,
						set: { fixed_rate: Decimal.of('500'), spread_pct: Decimal.of('90') }
					}
				])
			);
			committed(
				'pricing_floors',
				yield* as.act('pricing_floors.update', [
					{
						target: floor,
						set: { floor_price: Decimal.of('100') }
					}
				])
			);
			expect(yield* commissionOf(as, {})).toEqual(before);
			committed(
				'orders',
				yield* as.act('orders.update', [{ target: order, set: { archived: true } }])
			);
			expect(yield* commissionOf(as, {})).toEqual(before);
		})
);
