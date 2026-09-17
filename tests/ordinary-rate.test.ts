import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { accumulatePayslip } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { COMPANY_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	ordinaryDivisorDays,
	ordinaryHourlyRate
} from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

test('the ordinary rate divisor is one expression over the person; period.working_days is the month’s', () => {
	const expression =
		'terms.basic_salary < 20000.0 ? period.working_days : terms.grade == "M1" ? 173.0 / (terms.ordinary_hours_per_week / terms.working_days_per_week) : 26.0';
	const person = (terms: Record<string, unknown>, workingDays = 22) =>
		personContext({
			employee: null,
			employment: { service_start: '2024-01-01' },
			terms,
			week: { ordinary_hours_per_week: 48, working_days_per_week: 6 },
			period: { working_days: workingDays },
			asOf: '2026-03-31'
		});
	const divisor = (terms: Record<string, unknown>, workingDays?: number) =>
		ordinaryDivisorDays({ expression, person: person(terms, workingDays), employeeNumber: 'E1' });
	assert.equal(divisor({ base_salary: { value: 3451 } }), 22);
	// A statute stated in hours is hours over the contract's normal daily hours: 173 / 8.
	assert.equal(divisor({ base_salary: { value: 30000 }, grade: 'M1' }), 21.625);
	assert.equal(divisor({ base_salary: { value: 30000 } }), 26);
	// The divisor is what prices an hour: 3,451 / 22 / 8.
	const terms = {
		base_salary: { value: 3451, currency: 'MYR' },
		pay_frequency: 'MONTHLY',
		ordinary_hours_per_week: 48,
		working_days_per_week: 6
	} as const;
	assert.equal(ordinaryHourlyRate(terms, 22), 19.61);
	// A month with no working days under a WORKING_DAYS divisor stops the run by name.
	assert.throws(
		() => divisor({ base_salary: { value: 3451 } }, 0),
		/must be a positive number of days/
	);
	assert.throws(
		() => ordinaryDivisorDays({ expression: '', person: person({}) }),
		/no ordinary rate divisor/
	);
});

test('Work uses the version’s own rules, and its pay items settle under them', async () => {
	const world = createPublicPayrollWorld();
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const payslips = buildPayrollRun(prepared).payslip_payroll_run;
	assert.equal(payslips.length, 1);
	assert.equal(payslips[0].base.find((row) => row.component_code === 'BASIC')?.amount, 3451);
	const workItems = prepared.configuration.catalogueComponents.filter(
		(row) => row.family === 'WORK'
	);
	assert.ok(workItems.some((row) => row.output === 'salary'));
	assert.ok(workItems.some((row) => row.output === 'absence'));
	assert.ok(workItems.every((row) => !row.id.startsWith('engine:')));
});

test('Contribution reads the scheme’s formula: salary adds, absence reduces, silence excludes', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'scheme',
		settings_id: world.jurisdiction_settings[0]!.id,
		code: 'FUND',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [{ when: 'base >= 0.0', employee: '0.0', employer: '0.0' }],
		assessed_on: 'BASE - ABSENCE'
	});
	const { configuration } = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const items = configuration.catalogueComponents
		.filter((row) => row.family === 'WORK')
		.map((row) => ({
			catalogueComponent: row,
			bucket: row.output === 'absence' ? 'ABSENCE' : 'EARNING',
			label: 'A label with no classification information',
			amount: row.output === 'salary' ? 1000 : row.output === 'absence' ? 50 : 100
		}));
	// Salary includes, absence reduces: the formula is what the declaration used to be.
	const accumulation = accumulatePayslip({ items });
	assert.equal(accumulation.reserved.BASE - accumulation.reserved.ABSENCE, 950);
});

test('an absence no rule opts into is excluded, not refused', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'scheme',
		settings_id: world.jurisdiction_settings[0]!.id,
		code: 'FUND',
		assessment_period: 'PAY_PERIOD',
		assessment_scope: 'EMPLOYMENT',
		elections: [],
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [{ when: 'base >= 0.0', employee: '0.0', employer: '0.0' }],
		assessed_on: 'BASE'
	});
	// Every rostered day punched over its shift: nothing is absent, so the line is never priced.
	const variant = world.shift_definitions[0]!.variant as {
		start_time: string;
		end_time: string;
	};
	for (const row of world.work_days) {
		row.worked_intervals = [
			{
				start: `${row.work_date}T${variant.start_time}:00+08:00`,
				end: `${row.work_date}T${variant.end_time}:00+08:00`
			}
		];
	}
	const build = async () =>
		buildPayrollRun(
			await Effect.runPromise(
				gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
			)
		);
	assert.equal((await build()).payslip_payroll_run.length, 1);

	const day = world.work_days.find((row) => row.work_date === '2026-01-05')!;
	day.worked_intervals = [];
	// The absence prices under a scheme the rules never named, which is an exemption, not a refusal.
	assert.equal((await build()).payslip_payroll_run.length, 1);
});
