import { describe, expect, it } from '@effect/vitest';
import { accruedDays, interest, tenorDays } from '../src/lib/calculations.js';
import { invoiceFindings, poStatus } from '../src/lib/purchasing.js';
import {
	adviceChecks,
	costOfFundsTrend,
	estimateCharges,
	feeAmount,
	headroom,
	maturities,
	monthEndReport,
	periodCost,
	usdPerUnit,
	utilisation,
	weightedRate,
	type FacilityRow,
	type FeeRow,
	type LineRow
} from '../src/lib/treasury.js';

/** Synthetic figures with known answers; no customer, bank or rate from any real book. */
const facility = (
	id: string,
	code: string,
	limit: string,
	extra: Partial<FacilityRow> = {}
): FacilityRow => ({
	id,
	name: `${code} line`,
	status: 'active',
	limit,
	max_tenor_days: 150,
	day_count_basis: 'actual_360',
	interest_rounding: 'nearest_cent',
	margin_pct: null,
	bank: { code },
	...extra
});
const line = (id: string, extra: Partial<LineRow>): LineRow => ({
	id,
	status: 'active',
	product: 'if',
	currency: 'USD',
	amount: '1000000.00',
	amount_usd: '1000000.00',
	interest_rate_pct: '5.000000',
	day_count_basis: 'actual_360',
	start_date: '2026-01-01',
	due_date: '2026-03-02',
	application_date: null,
	settlement_date: null,
	facility: 'f1',
	...extra
});

describe('interest', () => {
	it('is amount × rate × days ÷ basis, counting the start day and not the due day', () => {
		expect(tenorDays('2026-01-01', '2026-03-02')).toBe(60);
		expect(interest('1000000.00', '5', 60, 'actual_360')).toBe('8333.33');
		expect(interest('1000000.00', '5', 60, 'actual_365')).toBe('8219.18');
	});
	it('rounds the way the bank does: nearest cent, or down to the cent', () => {
		// 123456.78 × 4.5% × 30 / 360 = 462.962925
		expect(interest('123456.78', '4.5', 30, 'actual_360', 'nearest_cent')).toBe('462.96');
		// 100000 × 5% × 1 / 360 = 13.8888…
		expect(interest('100000', '5', 1, 'actual_360', 'nearest_cent')).toBe('13.89');
		expect(interest('100000', '5', 1, 'actual_360', 'down_to_cent')).toBe('13.88');
	});
	it('is unknown when a figure is missing', () => {
		expect(interest('1000', null, 30, 'actual_360')).toBeNull();
		expect(interest('1000', '5', null, 'actual_360')).toBeNull();
	});
	it('accrues to the close of a day, never past the tenor or before the start', () => {
		expect(accruedDays('2026-01-01', '2026-03-02', '2026-01-31')).toBe(31);
		expect(accruedDays('2026-01-01', '2026-03-02', '2026-06-30')).toBe(60);
		expect(accruedDays('2026-02-01', '2026-03-02', '2026-01-31')).toBe(0);
	});
});

describe('usage and maturities', () => {
	const facilities = [facility('f1', 'AAA', '2000000.00'), facility('f2', 'BBB', '1000000.00')];
	const lines = [
		line('a', {}),
		line('b', {
			facility: 'f2',
			amount: '850000.00',
			amount_usd: '850000.00',
			due_date: '2026-01-20'
		}),
		line('c', { status: 'earmarked', amount_usd: '300000.00' }),
		line('d', { status: 'earmarked', facility: null, amount_usd: '50000.00' }),
		line('e', { status: 'settled', amount_usd: '999999.00' })
	];
	it('counts applied and active as used, earmarks apart, and warns at 80%', () => {
		const { banks, total } = utilisation(facilities, lines);
		expect(total).toMatchObject({
			limit: '3000000',
			used: '1850000',
			earmarked: '350000',
			available: '1150000'
		});
		expect(banks.find((b) => b.bank === 'BBB')).toMatchObject({ used_pct: 85, high: true });
		expect(banks.find((b) => b.bank === 'AAA')?.high).toBe(false);
	});
	it('leaves a line out of its own headroom', () => {
		expect(headroom(facilities, lines, 'c').find((h) => h.facility === 'f1')?.available).toBe(
			'1000000'
		);
		expect(headroom(facilities, lines).find((h) => h.facility === 'f1')?.available).toBe('700000');
	});
	it('buckets open lines by days to their due date', () => {
		const due = maturities(lines, '2026-01-25');
		expect(due.find((b) => b.key === 'past')).toMatchObject({ count: 1, amount: '850000' });
		expect(due.find((b) => b.key === 'd60')).toMatchObject({ count: 1, amount: '1000000' });
	});
	it('weights the cost of funds by amount', () => {
		const rated = [
			line('x', { amount_usd: '1000000', interest_rate_pct: '5' }),
			line('y', { amount_usd: '25000', interest_rate_pct: '9' })
		];
		expect(weightedRate(rated)).toBe('5.0976');
		expect(costOfFundsTrend(rated, '2026-03-15', 2).map((p) => p.lines)).toEqual([2, 0]);
	});
	it('weights a period by amount × the days each line was open in it', () => {
		const banks = new Map([['f1', 'AAA']]);
		const [all] = periodCost([line('p', {})], banks, '2026-01-01', '2026-01-30');
		expect(all).toMatchObject({ bank: 'all', rate: '5', interest: '4166.67', lines: 1 });
	});
});

describe('FX and charges', () => {
	const rates = [
		{ currency: 'SGD', rate_date: '2026-01-31', usd_per_unit: '0.75' },
		{ currency: 'SGD', rate_date: '2026-02-28', usd_per_unit: '0.80' }
	];
	const fee = (extra: Partial<FeeRow>): FeeRow => ({
		facility: 'f1',
		fee_type: 'commission',
		product: null,
		stage: 'drawdown',
		method: 'percent',
		currency: 'USD',
		rate_pct: '0.125',
		amount: null,
		minimum_amount: null,
		include_in_estimates: true,
		...extra
	});
	it('takes the latest rate on or before the day, else the latest known', () => {
		expect(usdPerUnit('SGD', '2026-02-15', rates)).toBe('0.75');
		expect(usdPerUnit('SGD', '2026-01-01', rates)).toBe('0.80');
		expect(usdPerUnit('EUR', '2026-02-15', rates)).toBeNull();
		expect(usdPerUnit('USD', '2026-02-15', rates)).toBe('1');
	});
	it('applies a fee rule with its minimum in its own currency', () => {
		expect(feeAmount(fee({}), '100000', '2026-02-15', rates)).toBe('125');
		expect(
			feeAmount(fee({ currency: 'SGD', minimum_amount: '200' }), '100000', '2026-02-15', rates)
		).toBe('150');
		expect(
			feeAmount(fee({ method: 'flat', amount: '50', currency: 'SGD' }), '1', '2026-03-01', rates)
		).toBe('40');
		expect(feeAmount(fee({ currency: 'EUR' }), '100000', '2026-02-15', rates)).toBeNull();
	});
	it('estimates only stages without an actual charge, an agreed rate replacing the commission', () => {
		const fees = [
			fee({}),
			fee({ fee_type: 'cable', method: 'flat', amount: '50' }),
			fee({ stage: 'settlement', rate_pct: '0.1' })
		];
		const l = { ...line('l', { amount_usd: '200000' }), charge_rate_pct: null };
		expect(estimateCharges(l, fees, ['settlement'], rates, '2026-02-01')).toEqual([
			{ stage: 'drawdown', charge_type: 'commission', amount: '250' },
			{ stage: 'drawdown', charge_type: 'cable', amount: '50' }
		]);
		const agreed = { ...l, charge_rate_pct: '0.2' };
		expect(estimateCharges(agreed, fees, ['settlement'], rates, '2026-02-01')).toEqual([
			{ stage: 'drawdown', charge_type: 'cable', amount: '50' },
			{ stage: 'drawdown', charge_type: 'commission', amount: '400' }
		]);
	});
});

describe('month-end', () => {
	const facilities = [
		facility('f1', 'AAA', '5000000'),
		facility('f2', 'BBB', '1000000', { interest_rounding: 'down_to_cent' })
	];
	const rates = [{ currency: 'JPY', rate_date: '2026-01-31', usd_per_unit: '0.0065' }];
	const row = (id: string, extra: Partial<LineRow>) => ({
		...line(id, extra),
		bank_reference: id,
		supplier_name: null,
		rounding: 'nearest_cent' as const,
		charges_usd: '0'
	});
	const report = monthEndReport(
		'2026-01-01',
		[
			row('open', {}),
			row('lc', { product: 'lc', interest_rate_pct: null, amount: '200000', amount_usd: '200000' }),
			row('yen', {
				facility: 'f2',
				currency: 'JPY',
				amount: '10000000',
				amount_usd: '70000',
				interest_rate_pct: '1',
				day_count_basis: 'actual_365'
			}),
			row('repaid', { status: 'settled', settlement_date: '2026-01-20' }),
			row('later', { start_date: '2026-02-03' })
		],
		facilities,
		rates
	);
	it('takes the lines owed at the close: started by then, not repaid', () => {
		expect(report.lines.map((l) => l.reference)).toEqual(['open', 'lc', 'yen']);
	});
	it('accrues to the month-end and revalues at the month-end rate', () => {
		const open = report.lines.find((l) => l.reference === 'open');
		expect(open).toMatchObject({
			accrued_days: 31,
			accrued_interest: '4305.56',
			interest_to_maturity: '8333.33'
		});
		expect(report.lines.find((l) => l.reference === 'yen')).toMatchObject({
			fx_rate_to_usd: '0.0065',
			amount_usd: '65000',
			accrued_interest: '8493.15'
		});
	});
	it('totals by product line and weights the rate by USD amount', () => {
		expect(report.figures).toMatchObject({
			credit_line: '6000000',
			bank_borrowings: '1065000',
			letters_of_credit: '200000',
			total_utilised: '1265000',
			available: '4735000',
			highest_rate_pct: '5',
			lowest_rate_pct: '1'
		});
		expect(Number(report.figures.weighted_average_rate_pct)).toBeCloseTo(
			(1000000 * 5 + 65000 * 1) / 1065000,
			5
		);
	});
});

describe('advice and invoice checks', () => {
	it('recomputes an advice’s days, interest and total debited', () => {
		const checks = adviceChecks(
			{
				principal: '1000000',
				interest_rate_pct: '5',
				interest_amount: '8333.34',
				interest_days: 60,
				start_date: '2026-01-01',
				due_date: '2026-03-02',
				total_debited: '1008333.34',
				charges: []
			},
			'actual_360',
			'nearest_cent'
		);
		expect(checks.map((c) => [c.key, c.ok])).toEqual([
			['check.days', true],
			['check.interest', false],
			['check.total', true]
		]);
	});
	const po = {
		currency: 'USD',
		supplier: 's1',
		is_cancelled: false,
		lines: [
			{ id: 'l1', item: 'Grade A', quantity: '1000', amount: '2000', invoiced_quantity: '1100' }
		]
	};
	it('flags price per kg, quantity over the PO, currency, total and the financing', () => {
		const findings = invoiceFindings(
			{
				invoice_number: 'I-1',
				currency: 'EUR',
				amount: '2300',
				lines: [{ po_line: 'l1', quantity: '1100', amount: '2200' }]
			},
			po,
			{ supplier: 's2', amount: '2000', invoiced: '2300' }
		);
		expect(findings.map((f) => f.key)).toEqual([
			'finding.total',
			'finding.currency',
			'finding.quantity',
			'finding.financing_supplier',
			'finding.financing_over'
		]);
		const priced = invoiceFindings(
			{
				invoice_number: 'I-2',
				currency: 'USD',
				amount: '210',
				lines: [{ po_line: 'l1', quantity: '100', amount: '210' }]
			},
			{ ...po, lines: [{ ...po.lines[0]!, invoiced_quantity: '100' }] },
			null
		);
		expect(priced.map((f) => f.key)).toEqual(['finding.price']);
		expect(poStatus(po)).toBe('over_invoiced');
	});
});
