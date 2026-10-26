import { SourceRowInvalid } from '../src/integration/kingdee/polling.js';
import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import type { DatabaseRequest } from '@norbital-ai/bolt/engine';
import {
	sourceOrderBatch,
	sourceOrderDocument,
	settlementDate,
	type OrderPayload,
	type SourceOrderBindings
} from '../src/integration/kingdee/order-batch.js';
import {
	sourceOrderSql,
	sourceOrderUuid,
	submitOrder
} from '../src/integration/kingdee/submission.js';

const payload: OrderPayload = {
	order_id: 'order-a',
	reference: "SO-';&<",
	direction: 'sales',
	agreement_hash: 'seal-a',
	version: 1,
	owner_id: 'member-a',
	ordered_on: '2026-10-26',
	currency: 'USD',
	tax_inclusive: true,
	party_code: '101',
	payment_terms: 'NET30',
	lines: [
		{
			id: 'line-a',
			product_code: '301',
			unit: 'kg',
			quantity: '5',
			unit_price: '12.6',
			discount_pct: '0',
			tax_rate: '13',
			net: '55.75',
			tax: '7.25',
			total: '63.00'
		}
	]
};
const bindings: SourceOrderBindings = {
	branchNo: '0',
	billerId: '1',
	employeeId: '701',
	departmentId: '601',
	customerId: '101',
	settlementId: '1',
	currencyId: '133',
	baseCurrency: 'CNY',
	rate: '7.2',
	packagingId: '',
	creditDays: 30,
	fromMonthEnd: false,
	items: [{ itemId: '301', unitId: '401' }]
};
const configuration = {
	baseCurrency: 'CNY',
	branchNo: '0',
	billerId: '1',
	salespersonBindings: JSON.stringify({ 'member-a': { employeeId: '701', departmentId: '601' } }),
	currencyBindings: JSON.stringify({
		CNY: { id: '1', base: true },
		USD: { id: '133', base: false }
	}),
	settlementRules: JSON.stringify({ NET30: { creditDays: 30, fromMonthEnd: false } })
};
const lookupRows = [
	{ kind: 'customer', local: '', id: '101', unit_id: '', unit_name: '', rate: '' },
	{ kind: 'settlement', local: '', id: '1', unit_id: '', unit_name: '', rate: '' },
	{ kind: 'employee', local: '', id: '701', unit_id: '', unit_name: '', rate: '' },
	{ kind: 'department', local: '', id: '601', unit_id: '', unit_name: '', rate: '' },
	{ kind: 'currency', local: '', id: '133', unit_id: '', unit_name: '', rate: '7.2' },
	{ kind: 'item', local: 'line-a', id: '301', unit_id: '401', unit_name: 'kg', rate: '' }
];
const context = () => {
	const calls: DatabaseRequest[] = [];
	return {
		configuration,
		calls,
		request: Effect.fnUntraced(function* (operation: DatabaseRequest) {
			calls.push(operation);
			if (operation.op !== 'call' || operation.procedure.name !== 'sp_executesql')
				throw new Error('Existing SQL RPC required');
			if (operation.arguments.stmt !== sourceOrderSql) return { rows: lookupRows };
			const hash = operation.arguments.fingerprint;
			if (typeof hash !== 'string') throw new Error('Fingerprint required');
			return { rows: [{ remote: '9002', hash }] };
		})
	};
};

it('projects the real sales header and all price/amount fields with precise foreign-currency math', () => {
	const batch = sourceOrderBatch(payload, bindings);
	expect(batch.header).toMatchObject({
		FTranType: '81',
		FCustID: '101',
		FEmpID: '701',
		FDeptID: '601',
		FSaleStyle: '102',
		FSettleDate: '2026-11-25T00:00:00'
	});
	expect(batch.header).not.toHaveProperty('FCheckerID');
	expect(batch.header).not.toHaveProperty('FCheckDate');
	expect(batch.items[0]).toMatchObject({
		FEntryID: '1',
		FItemID: '301',
		FUnitID: '401',
		Fauxprice: '11.15044248',
		FTaxPrice: '12.600000000000',
		FAmount: '55.75',
		FTaxAmt: '7.25',
		FAllAmount: '63.00',
		FAllStdAmount: '453.60'
	});
	expect(sourceOrderDocument(batch)).toContain('SO-&apos;;&amp;&lt;');
	expect(
		sourceOrderBatch(payload, { ...bindings, baseCurrency: 'KWD', rate: '7.12345' }).items[0]
			?.FAllStdAmount
	).toBe('448.777');
});

it('carries the approved discount into the source effective price and refuses inconsistent sealed amounts', () => {
	const line = {
		...payload.lines[0],
		id: 'line-a',
		product_code: '301',
		unit: 'kg',
		quantity: '3',
		unit_price: '100',
		discount_pct: '10',
		tax_rate: '10',
		net: '270.00',
		tax: '27.00',
		total: '297.00'
	};
	const batch = sourceOrderBatch({ ...payload, tax_inclusive: false, lines: [line] }, bindings);
	expect(batch.items[0]).toMatchObject({
		Fauxprice: '90.000000000000',
		FTaxPrice: '99.00000000',
		FAmount: '270.00',
		FTaxAmt: '27.00',
		FAllAmount: '297.00'
	});
	expect(() =>
		sourceOrderBatch(
			{
				...payload,
				lines: [
					{
						...payload.lines[0],
						id: 'line-a',
						product_code: '301',
						unit: 'kg',
						quantity: '5',
						unit_price: '12.6',
						discount_pct: '0',
						tax_rate: '13',
						net: '1',
						tax: '7.25',
						total: '63.00'
					}
				]
			},
			bindings
		)
	).toThrow(SourceRowInvalid);
	expect(settlementDate('2026-12-15', 30, true)).toBe('2027-01-31');
	expect(settlementDate('2026-12-15', 60, true)).toBe('2027-01-31');
	expect(settlementDate('2026-12-15', 0, true)).toBe('2026-12-31');
});

it.effect('uses only the existing RPC with stable provenance and bound data on retries', () =>
	Effect.gen(function* () {
		const ctx = context();
		expect(yield* submitOrder(payload, 'order-a:seal-a', ctx)).toBe('sales:0:9002:seal-a');
		expect(yield* submitOrder(payload, 'order-a:seal-a', ctx)).toBe('sales:0:9002:seal-a');
		const writes = ctx.calls.filter(
			(operation) => operation.op === 'call' && operation.arguments.stmt === sourceOrderSql
		);
		expect(writes).toHaveLength(2);
		for (const operation of writes) {
			if (operation.op !== 'call') throw new Error('RPC required');
			expect(operation.transaction).toBe('serializable');
			expect(operation.arguments.correlation).toBe(
				yield* sourceOrderUuid(payload.order_id, payload.agreement_hash)
			);
			expect(operation.arguments.stmt).not.toContain(payload.reference);
			expect(operation.arguments.document).toContain('SO-&apos;;&amp;&lt;');
		}
		expect(writes[0]).toEqual(writes[1]);
		expect(sourceOrderSql).toContain('dbo.ICMaxNum WITH (UPDLOCK,ROWLOCK)');
		expect(sourceOrderSql).toContain('FUUID=CAST(@correlation AS uniqueidentifier)');
		expect(sourceOrderSql).toContain('Source order line count differs');
		expect(sourceOrderSql.indexOf('Source order header differs')).toBeGreaterThan(
			sourceOrderSql.indexOf('INSERT INTO dbo.SEOrderEntry')
		);
		expect(sourceOrderSql).not.toMatch(/\bTHROW\b|\bMERGE\b|\bOPENJSON\b/);
	})
);

it.effect(
	'refuses unverified purchase/amendment writes and unmapped source IDs before network access',
	() =>
		Effect.gen(function* () {
			const ctx = context();
			expect(
				yield* Effect.flip(
					submitOrder({ ...payload, direction: 'purchasing' }, 'order-a:seal-a', ctx)
				)
			).toMatchObject({ _tag: 'SourceRowInvalid', column: 'direction' });
			expect(
				yield* Effect.flip(submitOrder({ ...payload, version: 2 }, 'order-a:seal-a', ctx))
			).toMatchObject({ _tag: 'SourceRowInvalid', column: 'version' });
			expect(
				yield* Effect.flip(
					submitOrder({ ...payload, party_code: 'customer-name' }, 'order-a:seal-a', ctx)
				)
			).toMatchObject({ _tag: 'SourceRowInvalid', column: 'party_code' });
			expect(ctx.calls).toHaveLength(0);
		})
);
