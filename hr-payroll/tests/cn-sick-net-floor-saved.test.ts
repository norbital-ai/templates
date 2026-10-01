// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { accumulateSettledPayslip } from '../src/lib/payroll/run/accumulate.ts';
import { calculateLeavePayroll } from '../src/lib/leave/payroll.ts';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import {
	COMPANY_ID,
	adhocCatalogue,
	createStatutoryWorld,
	leaveCatalogue,
	settingsIdOn
} from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';
function world({
	period = '2026-03',
	wage = 5000,
	hire = '2025-10-01',
	from = `${period}-01`,
	to = `${period}-31`,
	half = false,
	base = 7460,
	taxResidency = 'RESIDENT',
	code = 'CN-shanghai'
} = {}) {
	const worksite = code === 'CN-shanghai' ? 'SHANGHAI' : '云南省/昆明市/五华区';
	const tables = createStatutoryWorld({
		code,
		period,
		region: code === 'CN-shanghai' ? 'SHANGHAI' : 'KUNMING',
		companyFacts: {
			injury_rate: 0.2,
			housing_fund_rate: 7,
			housing_fund_supplementary_rate: 0,
			unemployment_employer_rate: 0.5,
			unemployment_employee_rate: 0.5
		},
		people: [
			{
				key: 'CN-SICK-FLOOR',
				wage,
				worksite,
				hire_date: hire,
				tax_residency: taxResidency,
				registrations: {
					PENSION: { kind: 'REGISTERED', elections: { contribution_base: base } },
					HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: base } }
				}
			}
		]
	});
	tables.companies[0].pay_cutoff_day = 1;
	const employment = tables.employments[0],
		term = tables.employment_terms[0];
	const row = leaveCatalogue(code).find(
		(row) => row.code === 'SICK_LEAVE' && row.settings_id === settingsIdOn(code, from)
	);
	tables.leave_catalogue.push(row);
	const charges = [];
	for (
		let date = new Date(`${from}T00:00:00Z`);
		date <= new Date(`${to}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() + 1)
	) {
		if ([0, 6].includes(date.getUTCDay())) continue;
		charges.push({
			date: date.toISOString().slice(0, 10),
			days: half ? 0.5 : 1,
			catalogue_id: row.id,
			employment_term_id: term.id,
			holiday_id: null,
			shift_definition_id: null,
			work_day_id: null
		});
	}
	tables.leave_entries.push({
		id: 'e1000000-0000-4000-8000-000000000071',
		employment_id: employment.id,
		catalogue_id: row.id,
		leave_code: 'SICK_LEAVE',
		reference: 'CN-SICK-FLOOR',
		from_date: from,
		to_date: to,
		effective_on: from,
		days: charges.reduce((sum, row) => sum + row.days, 0),
		half_day_start: false,
		half_day_end: false,
		charges,
		allocations: [],
		approval_id: null,
		payslip_id: null,
		certificate_file: 'c1000000-0000-4000-8000-000000000071',
		facts: { episode_start: from }
	});
	return tables;
}
const save = async (tables, period = '2026-03') =>
	(await runTransform(payrollRuns, [{ company_id: COMPANY_ID, period }], { tables }))[0].payslips
		.create[0];
const named = (slip) =>
	slip.statutory
		.filter((row) =>
			['PENSION', 'MEDICAL', 'UNEMPLOYMENT', 'HOUSING_FUND'].includes(row.scheme_code)
		)
		.reduce((sum, row) => sum + row.employee_amount, 0);
const topups = (slip) =>
	slip.adjustments.filter((row) => row.component_code === 'SICK_PAY_NET_FLOOR');
test('Shanghai full-month sick pay protects 80% minimum after employee insurance/fund shares', async () => {
	const tables = world(),
		original = structuredClone(tables);
	for (const row of original.jurisdiction_settings) delete row.payroll.leave_net_floors;
	const before = await save(original),
		slip = await save(tables);
	assert.ok(before.gross - named(before) < 2192);
	assert.equal(Number((slip.gross - named(slip)).toFixed(2)), 2192);
	assert.deepEqual(
		slip.statutory.filter((row) => row.scheme_code !== 'IIT'),
		before.statutory.filter((row) => row.scheme_code !== 'IIT')
	);
	assert.ok(topups(slip).length > 0);
	const frozen = slip.leave_settlements[0].pay_items.filter(
		(item) => item.reserved_line === 'BASE'
	);
	assert.equal(frozen.length, 22);
	assert.equal(
		frozen.reduce((sum, row) => sum + row.amount, 0).toFixed(2),
		topups(slip)
			.reduce((sum, row) => sum + row.amount, 0)
			.toFixed(2)
	);
});
test('Shanghai mixed and half-day sick pay prorates protected employee charges', async () => {
	for (const half of [false, true]) {
		const slip = await save(world({ from: '2026-03-02', to: '2026-03-06', half })),
			count = half ? 2.5 : 5;
		const deducted = slip.adjustments
			.filter((row) => row.component_code === 'SICK_LEAVE' && row.bucket === 'ABSENCE')
			.reduce((sum, row) => sum + row.amount, 0);
		const paid = (5000 / 21.75) * count - deducted;
		const expected =
			Math.round(((2192 / 21.75) * count + (named(slip) * count) / 22 - paid) * 100) / 100;
		assert.equal(
			Number(
				topups(slip)
					.reduce((sum, row) => sum + row.amount, 0)
					.toFixed(2)
			),
			expected
		);
	}
});
test('Kunming and Shanghai after expiry acquire no Shanghai net-floor topup', async () => {
	assert.deepEqual(topups(await save(world({ code: 'CN-kunming' }))), []);
	assert.deepEqual(
		topups(
			await save(world({ period: '2026-09', from: '2026-09-01', to: '2026-09-30' }), '2026-09')
		),
		[]
	);
});

test('frozen Shanghai topup reverses its original dates and BASE contribution direction', async () => {
	const tables = world(),
		slip = await save(tables),
		original = tables.leave_entries[0];
	const capture = slip.leave_settlements[0];
	const reversal = {
		...original,
		id: 'e1000000-0000-4000-8000-000000000072',
		as_adjustment_entry: true,
		reversal_of_id: original.id,
		effective_on: '2026-04-01',
		due_on: '2026-04-30',
		charges: [],
		days: null
	};
	const output = calculateLeavePayroll({
		prepared: {
			entries: [original, reversal],
			catalogues: tables.leave_catalogue,
			captures: [{ ...capture, paid: true, gross_amount: { value: 0, currency: 'CNY' } }],
			deductionEligibility: {}
		},
		window: { start: '2026-04-01', end: '2026-04-30' },
		dueThrough: '2026-04-30',
		currency: 'CNY',
		absenceRate: () => 999,
		encashmentRate: () => 999
	});
	const prior = capture.pay_items.filter((item) => item.reserved_line === 'BASE'),
		reversed = output.captures[0].pay_items.filter((item) => item.reserved_line === 'BASE');
	assert.deepEqual(
		reversed,
		prior.map((item) => ({ ...item, amount: -item.amount, quantity: -item.quantity }))
	);
	assert.ok(
		output.adjustments
			.filter((item) => item.catalogueComponent.code === 'SICK_PAY_NET_FLOOR')
			.every(
				(item) =>
					item.catalogueComponent.family === 'WORK' &&
					item.catalogueComponent.definition.source === 'DERIVED_NORMAL'
			)
	);
});
test('partial employment uses only employed paid days for protected-charge allocation', async () => {
	const tables = world({ hire: '2026-03-16', from: '2026-03-16', to: '2026-03-20' }),
		slip = await save(tables);
	const count = 5,
		paidDays = 12;
	const deduction = slip.adjustments
		.filter((row) => row.component_code === 'SICK_LEAVE')
		.reduce((sum, row) => sum + row.amount, 0);
	const expected = Number(
		(
			(2192 / 21.75) * count +
			(named(slip) * count) / paidDays -
			((5000 / 21.75) * count - deduction)
		).toFixed(2)
	);
	assert.equal(
		Number(
			topups(slip)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		),
		expected
	);
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'IIT').employee_amount, 0);
});

test('final IIT assesses the taxable BASE topup after protected charges', async () => {
	const tables = world({ wage: 8000, base: 20000, taxResidency: 'NON_RESIDENT' }),
		slip = await save(tables);
	assert.ok(topups(slip).length > 0);
	assert.equal(Number((slip.gross - named(slip)).toFixed(2)), 2192);
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'IIT').employee_amount, 20.76);
	assert.equal(slip.gross, 5692);
});

async function freeze(tables, period, kind = 'REGULAR') {
	const result = (
		await runTransform(payrollRuns, [{ company_id: COMPANY_ID, period, kind }], { tables })
	)[0];
	const runId = `run-${period}-${kind}`;
	tables.payroll_runs.push({ ...result, id: runId, payslips: undefined });
	for (const slip of result.payslips.create) {
		slip.id = crypto.randomUUID();
		tables.payslips.push({
			...slip,
			payroll_run_id: runId,
			status: 'PAID',
			paid_at: `${period}-28`
		});
		for (const capture of slip.leave_settlements) {
			const source = tables.leave_entries.find((row) => row.id === capture.leave_entry_id);
			if (source && source.payslip_id == null) source.payslip_id = slip.id;
		}
	}
	return result.payslips.create[0];
}
test('cutoff continuation settles the calendar illness month once from frozen history', async () => {
	const regular = await save(world());
	const tables = world();
	tables.companies[0].pay_cutoff_day = 21;
	const march = await freeze(tables, '2026-03');
	const april = await freeze(tables, '2026-04');
	const actual = [...topups(march), ...topups(april)].reduce((sum, row) => sum + row.amount, 0);
	const expected = topups(regular).reduce((sum, row) => sum + row.amount, 0);
	assert.equal(Number(actual.toFixed(2)), Number(expected.toFixed(2)));
	assert.ok(
		april.leave_settlements[0].pay_items
			.filter((item) => item.reserved_line === 'BASE')
			.every((item) => item.date.startsWith('2026-03'))
	);
});

test('illness recorded after EARLY salary settles calendar-month delta from frozen wages', async () => {
	const expected = await save(world()),
		tables = world(),
		entry = tables.leave_entries.pop();
	await freeze(tables, '2026-03');
	tables.payroll_runs[0].kind = 'EARLY';
	tables.leave_entries.push(entry);
	const april = await freeze(tables, '2026-04');
	assert.equal(
		Number(
			topups(april)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		),
		Number(
			topups(expected)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		)
	);
});

test('historical net-floor adjustments retain frozen BASE landing without a live catalogue', async () => {
	const slip = await save(world());
	const rows = topups(slip);
	assert.ok(rows.every((row) => row.reserved_line === 'BASE'));
	const accumulation = accumulateSettledPayslip({ base: [], adjustments: rows }, new Map());
	assert.equal(
		Number(accumulation.reserved.BASE.toFixed(2)),
		Number(rows.reduce((sum, row) => sum + row.amount, 0).toFixed(2))
	);
});
test('two concurrent contracts share one person floor regardless of source ordering', async () => {
	const single = await save(world({ wage: 9000, base: 20000 }));
	const first = world({ wage: 4500, base: 20000 }),
		second = world({ wage: 4500, base: 20000 });
	const employment = structuredClone(second.employments[0]),
		term = structuredClone(second.employment_terms[0]);
	employment.id = crypto.randomUUID();
	employment.employee_number = 'CN-SICK-FLOOR-2';
	term.id = crypto.randomUUID();
	term.employment_id = employment.id;
	first.employments.push(employment);
	first.employment_terms.push(term);
	first.employment_statutory_facts.push(
		...second.employment_statutory_facts.map((row) => ({
			...row,
			id: crypto.randomUUID(),
			employment_id: employment.id
		}))
	);
	const leave = structuredClone(second.leave_entries[0]);
	leave.id = crypto.randomUUID();
	leave.employment_id = employment.id;
	leave.charges = leave.charges.map((row) => ({ ...row, employment_term_id: term.id }));
	first.leave_entries.push(leave);
	const reversed = structuredClone(first);
	reversed.employments.reverse();
	reversed.leave_entries.reverse();
	const result = async (tables) =>
		(
			await runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: '2026-03' }], { tables })
		)[0].payslips.create;
	const slips = await result(first),
		other = await result(reversed);
	const total = (rows) =>
		Number(
			rows
				.reduce(
					(sum, slip) => sum + topups(slip).reduce((amount, row) => amount + row.amount, 0),
					0
				)
				.toFixed(2)
		);
	assert.equal(total(slips), total([single]));
	assert.equal(total(other), total(slips));
	assert.equal(
		Number(slips.reduce((sum, slip) => sum + slip.gross - named(slip), 0).toFixed(2)),
		2192
	);
});

test('OFF_CYCLE early salary freezes floor once before selected bonus', async () => {
	const tables = world(),
		bonus = adhocCatalogue('CN-shanghai').find(
			(row) => row.code === 'BONUS' && row.settings_id === settingsIdOn('CN-shanghai', '2026-03-10')
		);
	tables.adhoc_catalogue.push(bonus);
	const request = crypto.randomUUID();
	tables.adhoc_requests.push({
		id: request,
		employment_id: tables.employments[0].id,
		catalogue_id: bonus.id,
		amount: 500,
		event_date: '2026-03-10',
		pay_period: '2026-03',
		payslip_id: null,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null,
		reason: 'Off-cycle ordering regression'
	});
	const result = (
		await runTransform(
			payrollRuns,
			[{ company_id: COMPANY_ID, period: '2026-03', kind: 'OFF_CYCLE', sources: [request] }],
			{ tables }
		)
	)[0];
	const early = result.early_settlements.create[0].payslips.create[0],
		own = result.payslips.create[0];
	const regular = await save(world());
	assert.equal(
		Number(
			topups(early)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		),
		Number(
			topups(regular)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		)
	);
	assert.deepEqual(topups(own), []);
});
test('a circular protected contribution base refuses rather than guessing a floor', async () => {
	const tables = world();
	for (const scheme of tables.statutory_contributions.filter((row) => row.code === 'PENSION')) {
		scheme.assessed_on = 'BASE';
		scheme.rules = [
			{ when: 'base > 0.0', employee: 'round(base * 0.3, 0.01, "HALF_UP")', employer: '0.0' }
		];
	}
	await assert.rejects(
		() => save(tables),
		/changes protected PENSION contributions.*circular contribution base/
	);
});

test('saved payroll reversal negates the frozen floor after wage changes', async () => {
	const tables = world(),
		march = await freeze(tables, '2026-03'),
		original = tables.leave_entries[0];
	tables.employment_terms[0].base_salary = 6000;
	tables.leave_entries.push({
		...original,
		id: crypto.randomUUID(),
		as_adjustment_entry: true,
		reversal_of_id: original.id,
		payslip_id: null,
		charges: [],
		days: null,
		effective_on: '2026-04-01',
		due_on: '2026-04-30'
	});
	const april = await freeze(tables, '2026-04');
	const previous = march.leave_settlements[0].pay_items.filter(
		(item) => item.reserved_line === 'BASE'
	);
	const reversed = april.leave_settlements[0].pay_items.filter(
		(item) => item.reserved_line === 'BASE'
	);
	assert.deepEqual(
		reversed,
		previous.map((item) => ({ ...item, amount: -item.amount, quantity: -item.quantity }))
	);
	assert.ok(topups(april).every((item) => item.amount < 0 && item.reserved_line === 'BASE'));
});

test('mixed fully unpaid leave is excluded from employed paid-day charge allocation', async () => {
	const tables = world({ from: '2026-03-02', to: '2026-03-06' }),
		sick = tables.leave_entries[0];
	const catalogue = leaveCatalogue('CN-shanghai').find(
		(row) =>
			row.code === 'UNPAID_LEAVE' && row.settings_id === settingsIdOn('CN-shanghai', '2026-03-09')
	);
	tables.leave_catalogue.push(catalogue);
	const charges = sick.charges.map((row, index) => ({
		...row,
		date: `2026-03-${String(9 + index).padStart(2, '0')}`,
		catalogue_id: catalogue.id
	}));
	tables.leave_entries.push({
		...sick,
		id: crypto.randomUUID(),
		catalogue_id: catalogue.id,
		leave_code: 'UNPAID_LEAVE',
		from_date: '2026-03-09',
		to_date: '2026-03-13',
		effective_on: '2026-03-09',
		charges
	});
	const slip = await save(tables);
	const deduction = slip.adjustments
		.filter((row) => row.component_code === 'SICK_LEAVE')
		.reduce((sum, row) => sum + row.amount, 0);
	const expected = Number(
		((2192 / 21.75) * 5 + (named(slip) * 5) / 17 - ((5000 / 21.75) * 5 - deduction)).toFixed(2)
	);
	assert.equal(
		Number(
			topups(slip)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		),
		expected
	);
});

test('cancelled illness days do not inflate a saved replacement calendar-month floor', async () => {
	const tables = world({ from: '2026-03-02', to: '2026-03-06' }),
		march = await freeze(tables, '2026-03'),
		original = tables.leave_entries[0];
	tables.payroll_runs[0].kind = 'EARLY';
	tables.leave_entries.push({
		...original,
		id: crypto.randomUUID(),
		as_adjustment_entry: true,
		reversal_of_id: original.id,
		payslip_id: null,
		charges: [],
		days: null,
		effective_on: '2026-04-01',
		due_on: '2026-04-30'
	});
	const replacement = structuredClone(original);
	replacement.id = crypto.randomUUID();
	replacement.payslip_id = null;
	replacement.from_date = '2026-03-09';
	replacement.to_date = '2026-03-13';
	replacement.effective_on = '2026-03-09';
	replacement.charges = replacement.charges.map((row, index) => ({
		...row,
		date: `2026-03-${String(9 + index).padStart(2, '0')}`
	}));
	tables.leave_entries.push(replacement);
	const april = await freeze(tables, '2026-04');
	assert.ok(topups(april).some((item) => item.amount > 0));
	assert.equal(
		Math.abs(
			Number(
				topups(april)
					.reduce((sum, row) => sum + row.amount, 0)
					.toFixed(2)
			)
		),
		0
	);
	const regular = await save(world({ from: '2026-03-09', to: '2026-03-13' }));
	assert.equal(
		Number(
			topups(march)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		),
		Number(
			topups(regular)
				.reduce((sum, row) => sum + row.amount, 0)
				.toFixed(2)
		)
	);
});
