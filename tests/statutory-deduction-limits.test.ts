// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { settle } from '../src/lib/payroll/run/settle.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { settingsVersions, createStatutoryWorld, COMPANY_ID } from './fixtures/statutory-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { readLawFile } from './fixtures/law-file.ts';
import { accumulatePayslip } from '../src/lib/payroll/run/accumulate.ts';

const line = (code: string, amount: number, bucket = 'EARNING', family = 'ADHOC') => ({
	catalogueComponent: { id: code, code, family },
	label: code,
	amount,
	bucket,
	input: { family: family === 'LOAN' ? 'LOAN_REPAYMENT' : 'ADHOC', id: code }
});
const loan = (code: string, amount: number) => line(code, amount, 'DEDUCTION', 'LOAN');
const run = (ceiling, earnings, deductions, statutory = 0, finalPay = false) =>
	settle({
		base: earnings,
		adjustments: deductions,
		charges: [{ employee: statutory, employer: 0 }],
		currency: 'SGD',
		ceiling,
		finalPay
	});

test('SG EA ss.2,31: travel and termination benefits do not enlarge the instalment salary base', () => {
	for (const version of settingsVersions('SG')) {
		const ceiling = version.payroll.deduction_ceiling;
		const earnings = [
			line('BASIC', 2000),
			line('TRAVELLING_ALLOWANCE', 500),
			line('RETRENCHMENT_BENEFIT', 1000),
			line('GRATUITY', 500)
		];
		// Salary for s.31 is 2,000, although payslip gross is 4,000: the quarter is 500.
		assert.equal(run(ceiling, earnings, [loan('STAFF', 500)]).net, 3500);
		assert.equal(run(ceiling, earnings, [loan('STAFF', 500.01)]).adjustments.length, 0);
		assert.equal(run(ceiling, earnings, [loan('STAFF', 500.01)], 0, true).adjustments.length, 0);
		// The same statutory salary definition governs s.32's half.
		assert.equal(
			run(ceiling, earnings, [line('CONSENTED', 1000.01, 'DEDUCTION')]).ceilingExcess,
			0.01
		);
	}
});

test('SG EA s.27(1)(f): overpaid salary can be recovered in full, unlike a loan instalment', () => {
	for (const version of settingsVersions('SG')) {
		const result = run(
			version.payroll.deduction_ceiling,
			[line('BASIC', 2000)],
			[loan('SALARY_OVERPAYMENT', 1500)]
		);
		assert.equal(result.net, 500);
		assert.deepEqual(result.shortfalls, []);
	}
});

test('MY EA s.24(9)(a): deductions FROM employer-paid notice indemnity are uncapped, up to that payment', () => {
	for (const code of ['MY'])
		for (const version of settingsVersions(code)) {
			const ceiling = version.payroll.deduction_ceiling;
			// 2,000 earned wages permits 1,000 deductions; 2,000 employer-paid indemnity permits another 2,000.
			const wages = [line('BASIC', 2000), line('NOTICE_IN_LIEU', 2000)];
			assert.equal(
				run(ceiling, wages, [line('CONSENTED', 2600, 'DEDUCTION')], 400).ceilingExcess,
				0
			);
			assert.equal(
				run(ceiling, wages, [line('CONSENTED', 2600.01, 'DEDUCTION')], 400).ceilingExcess,
				0.01
			);
			// The opposite debt (employee owes notice) is not generally exempt; final-pay s.24(9)(b) is separate.
			const deductions = [line('NOTICE_INDEMNITY', 2200, 'DEDUCTION')];
			assert.equal(run(ceiling, [line('BASIC', 4000)], deductions, 400).ceilingExcess, 600);
			assert.equal(run(ceiling, [line('BASIC', 4000)], deductions, 400, true).ceilingExcess, 0);
		}
});

test('MY EA s.24(9)(c): approved housing adds at most a quarter, solely for housing recovery', () => {
	for (const code of ['MY'])
		for (const version of settingsVersions(code)) {
			const ceiling = version.payroll.deduction_ceiling;
			// 4,000 wages, statutory 400 + ordinary 1,600 use the half. Approved housing gets 1,000 more.
			const fits = run(
				ceiling,
				[line('BASIC', 4000)],
				[loan('STAFF', 1600), loan('APPROVED_HOUSING_LOAN', 1000)],
				400
			);
			assert.equal(fits.net, 1000);
			assert.deepEqual(fits.shortfalls, []);
			const over = run(
				ceiling,
				[line('BASIC', 4000)],
				[loan('STAFF', 1600), loan('APPROVED_HOUSING_LOAN', 1000.01)],
				400
			);
			assert.deepEqual(
				over.adjustments.map((item) => item.label),
				['STAFF']
			);
			// A small housing recovery cannot increase ordinary deductions beyond their own half.
			const restricted = run(
				ceiling,
				[line('BASIC', 4000)],
				[loan('STAFF', 1800), loan('APPROVED_HOUSING_LOAN', 500)],
				400
			);
			assert.equal(restricted.ceilingExcess, 0);
			assert.equal(restricted.adjustments.length, 0);
			assert.equal(restricted.net, 3600);
		}
});

const withLoan = (code: string, period: string, loanCode: string) => {
	const world = createStatutoryWorld({ code, period, people: [{ key: 'BORROWER', wage: 4000 }] });
	world.loan_catalogue = readLawFile(`seed/jurisdiction/${code}/loan_catalogue`);
	const catalogue = world.loan_catalogue[0];
	const selected = world.loan_catalogue.find(
		(row) => row.settings_id === catalogue.settings_id && row.code === loanCode
	)!;
	world.loans.push({
		id: 'LOAN',
		employment_id: world.employments[0].id,
		loan_catalogue_id: selected.id,
		principal: 1000,
		disbursed_on: '2025-12-01',
		effective_range: { start: '2025-12-01', end: '2027-03-31' },
		approval_id: null
	});
	world.loan_repayments.push({
		id: 'REPAYMENT',
		loan_id: 'LOAN',
		employment_id: world.employments[0].id,
		due_date: `${period}-15`,
		amount_due: 500,
		sequence: 1,
		payslip_id: null,
		approval_id: null
	});
	return world;
};
const build = (world, period) =>
	buildPayrollRun(gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period }));

test('MY housing exception requires the permission on the actual loan before any recovery', () => {
	for (const code of ['MY']) {
		const world = withLoan(code, '2026-01', 'APPROVED_HOUSING_LOAN');
		assert.throws(() => build(world, '2026-01'), /written permission/);
		world.loans[0].approval_reference = 'DG written permission / synthetic fixture';
		const result = build(world, '2026-01');
		assert.ok(
			result.payslip_payroll_run[0].adjustments.some(
				(row) => row.family === 'LOAN_REPAYMENT' && row.amount === 500
			)
		);
	}
});

test('SG advance recovery keeps its 12-month origin after earlier instalments have been settled', () => {
	const world = withLoan('SG', '2027-02', 'SALARY_ADVANCE');
	world.loan_repayments.unshift({
		id: 'SETTLED',
		loan_id: 'LOAN',
		employment_id: world.employments[0].id,
		due_date: '2026-01-15',
		amount_due: 500,
		sequence: 0,
		payslip_id: 'PAID-SLIP',
		approval_id: null
	});
	assert.throws(() => build(world, '2027-02'), /exceeds 12 months/);
	// The same rule does not impose a 12-month limit on an ordinary overpayment recovery.
	world.loans[0].loan_catalogue_id = world.loan_catalogue.find(
		(row) => row.code === 'SALARY_OVERPAYMENT'
	).id;
	assert.ok(
		build(world, '2027-02').payslip_payroll_run[0].adjustments.some(
			(row) => row.family === 'LOAN_REPAYMENT'
		)
	);
});

test('SG EA s.31(1): pre-employment advances wait for a complete salary period; travel advances cannot be recovered', () => {
	const world = withLoan('SG', '2026-01', 'SALARY_ADVANCE');
	world.employments[0].effective_range.start = '2026-01-16';
	assert.throws(() => build(world, '2026-01'), /first completed salary period/);
	assert.ok(
		build(world, '2026-02').payslip_payroll_run[0].adjustments.some(
			(row) => row.family === 'LOAN_REPAYMENT'
		)
	);
	world.loans[0].loan_catalogue_id = world.loan_catalogue.find(
		(row) => row.code === 'TRAVEL_ADVANCE'
	).id;
	assert.throws(() => build(world, '2026-02'), /paid before employment cannot be recovered/);
	// A travel advance made after joining is recoverable under the ordinary advance limits.
	world.loans[0].disbursed_on = '2026-01-17';
	assert.ok(
		build(world, '2026-02').payslip_payroll_run[0].adjustments.some(
			(row) => row.family === 'LOAN_REPAYMENT'
		)
	);
	world.loans[0].disbursed_on = null;
	assert.throws(() => build(world, '2026-02'), /actual disbursement date/);
});

test('loan recoveries cannot bypass net deduction limits by reducing gross wages', async () => {
	const { default: catalogue } =
		await import('../src/data/collection/loan_catalogue/+collection.ts');
	const { transform } = await import('./helpers/bodies.ts');
	await assert.rejects(
		transform(catalogue, [{ code: 'GROSS_RECOVERY', destination: 'PAY', direction: 'SUBTRACT' }]),
		/net pay/
	);
	const world = withLoan('SG', '2026-01', 'SALARY_ADVANCE');
	for (const row of world.loan_catalogue)
		if (row.code === 'SALARY_ADVANCE') row.destination = 'PAY';
	assert.throws(() => build(world, '2026-01'), /net pay/);
});

test('MY and VN monthly deduction limits retain unused room and prior deductions across payslips', () => {
	for (const code of ['MY', 'VN']) {
		for (const version of settingsVersions(code)) {
			const ceiling = version.payroll.deduction_ceiling;
			const prior = {
				accumulation: accumulatePayslip({
					items: [line('BASIC', 2000), line('DAMAGE', 300, 'DEDUCTION')]
				}),
				charged: new Map([['SI', { employee: 250, employer: 0 }]])
			};
			// MY: 4,000 x 50% - (250 + 200 statutory) - 300 already recovered = 1,250.
			// VN: (4,000 - 250 - 200) x 30% - 300 = 765; union dues are not a base deduction.
			const room = code === 'VN' ? 765 : 1250;
			const calculate = (amount) =>
				settle({
					base: [line('BASIC', 2000)],
					adjustments: [line('DAMAGE', amount, 'DEDUCTION')],
					charges: [
						{ contribution: { row: { code: 'SI' } }, employee: 200, employer: 0 },
						...(code === 'VN'
							? [{ contribution: { row: { code: 'UNION_DUES' } }, employee: 20, employer: 0 }]
							: [])
					],
					currency: 'MYR',
					ceiling,
					monthPrior: prior
				});
			assert.equal(calculate(room).ceilingExcess, 0, `${code} ${version.code}`);
			assert.equal(calculate(room + 0.01).ceilingExcess, 0.01, code);
		}
	}
});

test('SG damage and accommodation limits remain independent of the final-pay aggregate exemption', () => {
	for (const version of settingsVersions('SG')) {
		for (const finalPay of [false, true]) {
			const ceiling = version.payroll.deduction_ceiling;
			assert.equal(
				run(
					ceiling,
					[line('BASIC', 4000)],
					[line('DAMAGE_RECOVERY', 1000.01, 'DEDUCTION')],
					0,
					finalPay
				).ceilingExcess,
				0.01
			);
			assert.equal(
				run(
					ceiling,
					[line('BASIC', 4000)],
					[
						line('ACCOMMODATION_RECOVERY', 600, 'DEDUCTION'),
						line('AMENITIES_RECOVERY', 400.01, 'DEDUCTION')
					],
					0,
					finalPay
				).ceilingExcess,
				0.01
			);
			assert.equal(
				run(
					ceiling,
					[line('BASIC', 4000)],
					[line('COOPERATIVE_DUES', 2500, 'DEDUCTION')],
					0,
					finalPay
				).ceilingExcess,
				0
			);
		}
	}
});

test('a lawful percentage limit never rounds upward to a currency unit the law does not allow', () => {
	for (const code of ['MY']) {
		assert.equal(
			run(
				settingsVersions(code)[0].payroll.deduction_ceiling,
				[line('BASIC', 3999.99)],
				[line('CONSENTED', 2000, 'DEDUCTION')]
			).ceilingExcess,
			0.01
		);
	}
	const result = settle({
		base: [line('BASIC', 10001)],
		adjustments: [line('DAMAGE', 3001, 'DEDUCTION')],
		charges: [],
		currency: 'VND',
		ceiling: settingsVersions('VN')[0].payroll.deduction_ceiling
	});
	assert.equal(result.ceilingExcess, 1);
});

test('SG each damage incident has its own quarter limit; Commissioner-approved damage retains only the aggregate half', () => {
	const ceiling = settingsVersions('SG')[0].payroll.deduction_ceiling;
	assert.equal(
		run(
			ceiling,
			[line('BASIC', 4000)],
			[line('DAMAGE_RECOVERY', 1000, 'DEDUCTION'), line('DAMAGE_RECOVERY', 1000, 'DEDUCTION')]
		).ceilingExcess,
		0
	);
	assert.equal(
		run(ceiling, [line('BASIC', 4000)], [line('APPROVED_DAMAGE_RECOVERY', 1500, 'DEDUCTION')])
			.ceilingExcess,
		0
	);
	assert.equal(
		run(ceiling, [line('BASIC', 4000)], [line('APPROVED_DAMAGE_RECOVERY', 2000.01, 'DEDUCTION')])
			.ceilingExcess,
		0.01
	);
});

test('MY payroll reads the first half payslip when recovering a lawful second-half instalment', () => {
	for (const code of ['MY']) {
		const world = createStatutoryWorld({
			code,
			period: '2026-01-1',
			payFrequency: 'SEMI_MONTHLY',
			people: [{ key: 'BORROWER', wage: 4000, pay_frequency: 'SEMI_MONTHLY' }]
		});
		const first = build(world, '2026-01-1');
		world.payroll_runs.push({
			id: 'FIRST',
			company_id: COMPANY_ID,
			period: '2026-01-1',
			approval_id: null
		});
		world.payslips.push(
			...first.payslip_payroll_run.map((slip) => ({
				...slip,
				payroll_run_id: 'FIRST',
				paid_at: '2026-01-15',
				approval_id: null
			}))
		);
		// A customer-defined ordinary loan class, without the housing exception.
		world.loan_catalogue = readLawFile(`seed/jurisdiction/${code}/loan_catalogue`).map((row) => ({
			...row,
			code: 'STAFF_LOAN'
		}));
		world.loans.push({
			id: 'LOAN',
			employment_id: world.employments[0].id,
			loan_catalogue_id: world.loan_catalogue[0].id,
			principal: 1400,
			effective_range: { start: '2026-01-01', end: null },
			approval_id: null
		});
		world.loan_repayments.push({
			id: 'REPAYMENT',
			loan_id: 'LOAN',
			employment_id: world.employments[0].id,
			due_date: '2026-01-20',
			amount_due: 1400,
			sequence: 1,
			payslip_id: null,
			approval_id: null
		});
		const second = build(world, '2026-01-2');
		assert.equal(
			second.payslip_payroll_run[0].adjustments.find((row) => row.family === 'LOAN_REPAYMENT')
				?.amount,
			1400,
			code
		);
		const gross = [...first.payslip_payroll_run, ...second.payslip_payroll_run].reduce(
			(sum, slip) => sum + slip.gross,
			0
		);
		const deductions = [...first.payslip_payroll_run, ...second.payslip_payroll_run].reduce(
			(sum, slip) => sum + slip.total_deductions,
			0
		);
		assert.equal(gross, 4000);
		assert.ok(deductions <= 2000);
		assert.ok(second.captures[0].loanRepayments.includes('REPAYMENT'));
	}
});
