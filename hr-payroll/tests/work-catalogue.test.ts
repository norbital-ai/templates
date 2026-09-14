import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { accumulateBases } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { COMPANY_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	ordinaryHourlyRate,
	resolveOrdinaryRate
} from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

type WorkRules = {
	engine_lines: Record<'salary' | 'absence' | 'night', { statutory_opt_ins: unknown[] }>;
	rates: {
		ordinary: { when: string; unit: 'DAY' | 'HOUR'; divisor: number | 'WORKING_DAYS' }[];
		bands: { line: string; label: string; statutory_opt_ins: unknown[] }[];
	};
};

const rulesOf = (world: ReturnType<typeof createPublicPayrollWorld>): WorkRules =>
	world.jurisdiction_settings[0]!.work_rules as WorkRules;

test('the ordinary rate is the first row whose predicate holds; WORKING_DAYS is the month’s working days', () => {
	const rows = [
		{ when: 'terms.basic_salary < 20000', unit: 'DAY', divisor: 'WORKING_DAYS' },
		{ when: 'terms.grade == "M1"', unit: 'HOUR', divisor: 173 },
		{ when: '', unit: 'DAY', divisor: 26 }
	] as const;
	const person = (terms: Record<string, unknown>) =>
		personContext({
			employee: null,
			employment: { service_start: '2024-01-01' },
			terms,
			asOf: '2026-03-31'
		});
	const workingDays = () => 22;
	assert.deepEqual(
		resolveOrdinaryRate({ rows, person: person({ base_salary: { value: 3451 } }), workingDays }),
		{ per: 'DAY', divisor: 22 }
	);
	assert.deepEqual(
		resolveOrdinaryRate({
			rows,
			person: person({ base_salary: { value: 30000 }, grade: 'M1' }),
			workingDays
		}),
		{ per: 'HOUR', divisor: 173 }
	);
	assert.deepEqual(
		resolveOrdinaryRate({ rows, person: person({ base_salary: { value: 30000 } }), workingDays }),
		{ per: 'DAY', divisor: 26 }
	);
	// The resolved divisor is what prices an hour: 3,451 / 22 / 8.
	const terms = {
		base_salary: { value: 3451, currency: 'MYR' },
		pay_frequency: 'MONTHLY',
		ordinary_hours_per_week: 48,
		working_days_per_week: 6
	} as const;
	assert.equal(
		ordinaryHourlyRate(terms, { rates: { ordinary: rows } } as never, { per: 'DAY', divisor: 22 }),
		19.61
	);
	assert.throws(
		() =>
			resolveOrdinaryRate({
				rows: rows.slice(0, 2),
				person: person({ base_salary: { value: 30000 } }),
				workingDays,
				employeeNumber: 'E1'
			}),
		/No ordinary rate row covers E1/
	);
	assert.throws(
		() =>
			resolveOrdinaryRate({
				rows,
				person: person({ base_salary: { value: 3451 } }),
				workingDays: () => 0
			}),
		/the month has none/
	);
	assert.throws(
		() => resolveOrdinaryRate({ rows: [], person: person({}), workingDays }),
		/no ordinary rate/
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

test('Contribution consumes Work metadata: opt-ins include, silence excludes', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'scheme',
		settings_id: world.jurisdiction_settings[0]!.id,
		code: 'FUND',
		assessment_period: 'PAY_PERIOD',
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [{ when: 'base >= 0.0', employee: '0.0', employer: '0.0' }]
	});
	const rules = rulesOf(world);
	rules.engine_lines.salary.statutory_opt_ins = [{ contribution_id: 'scheme', effect: 'INCLUDE' }];
	rules.engine_lines.absence.statutory_opt_ins = [{ contribution_id: 'scheme', effect: 'REDUCE' }];
	const { configuration } = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const items = configuration.catalogueComponents
		.filter((row) => row.family === 'WORK')
		.map((row) => ({
			catalogueComponent: row,
			bucket: 'EARNING',
			optIns:
				row.output === 'salary'
					? rules.engine_lines.salary.statutory_opt_ins
					: row.output === 'absence'
						? rules.engine_lines.absence.statutory_opt_ins
						: [],
			label: 'A label with no classification information',
			amount: row.output === 'salary' ? 1000 : row.output === 'absence' ? 50 : 100
		}));
	// Salary includes, absence reduces; a line the rules do not name is excluded.
	assert.equal(accumulateBases({ configuration, items, employeeNumber: 'TEST' })[0]?.base, 950);
});

test('an absence no rule opts into is excluded, not refused', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'scheme',
		settings_id: world.jurisdiction_settings[0]!.id,
		code: 'FUND',
		assessment_period: 'PAY_PERIOD',
		employee_share_annual_cap: null,
		shared_cap_group: null,
		project_relief_annually: false,
		rules: [{ when: 'base >= 0.0', employee: '0.0', employer: '0.0' }]
	});
	const rules = rulesOf(world);
	rules.engine_lines.salary.statutory_opt_ins = [{ contribution_id: 'scheme', effect: 'INCLUDE' }];
	// Every rostered day punched over its shift: nothing is absent, so the line is never priced.
	const variant = world.shift_definitions[0]!.variant as {
		start_time: string;
		end_time: string;
		break_minutes: number;
	};
	for (const row of world.work_days) {
		row.worked_intervals = [
			{
				start: `${row.work_date}T${variant.start_time}:00+08:00`,
				end: `${row.work_date}T${variant.end_time}:00+08:00`
			}
		];
		row.break_minutes = variant.break_minutes;
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
	day.break_minutes = 0;
	// The absence prices under a scheme the rules never named, which is an exemption, not a refusal.
	assert.equal((await build()).payslip_payroll_run.length, 1);
});
