import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { accumulateBases } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { COMPANY_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

test('Work uses stored rules and constant output codes, and refuses a missing catalogue', async () => {
	const world = createPublicPayrollWorld();
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const payslips = buildPayrollRun(prepared).payslip_payroll_run;
	assert.equal(payslips.length, 1);
	assert.equal(payslips[0].base.find((row) => row.component_code === 'BASIC')?.amount, 3451);
	assert.equal(prepared.configuration.work.id, world.work_catalogue[0].id);
	assert.ok(
		prepared.configuration.catalogueComponents.every((row) => !row.id.startsWith('engine:'))
	);
	world.work_catalogue.length = 0;
	await assert.rejects(
		Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		),
		/exactly one Work catalogue/
	);
});

test('Contribution consumes Work metadata without decoding overtime labels', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'scheme',
		settings_id: world.jurisdiction_settings[0].id,
		code: 'FUND',
		sequence: 1,
		special_rules: [],
		relief_for: [],
		rounding: 'NONE',
		bands: []
	});
	world.work_catalogue[0].treatments = {
		FUND: {
			salary: { kind: 'INCLUDE' },
			overtime: { kind: 'INCLUDE' },
			overtime_excess: { kind: 'EXCLUDE' },
			absence: { kind: 'REDUCE' }
		}
	};
	const { configuration } = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const items = configuration.catalogueComponents
		.filter((row) => row.family === 'WORK')
		.map((row) => ({
			catalogueComponent: row,
			nature: row.nature,
			label: 'A label with no classification information',
			amount: row.output === 'salary' ? 1000 : row.output === 'absence' ? 50 : 100
		}));
	assert.equal(accumulateBases({ configuration, items, employeeNumber: 'TEST' })[0]?.base, 1050);
	const overtime = configuration.catalogueComponents.find((row) => row.output === 'overtime')!;
	const treatments = new Map(configuration.treatments);
	treatments.delete(`${overtime.id}:scheme`);
	assert.equal(
		accumulateBases({
			configuration: { ...configuration, treatments },
			items,
			employeeNumber: 'TEST'
		})[0]?.base,
		1050
	);
	assert.throws(
		() =>
			accumulateBases({
				configuration: { ...configuration, treatments },
				items: items.map((item) =>
					item.catalogueComponent.id === overtime.id
						? {
								...item,
								catalogueComponent: { ...item.catalogueComponent, contribution_treatments: {} }
							}
						: item
				),
				employeeNumber: 'TEST'
			}),
		/No FUND treatment exists for OVERTIME/
	);
});

/**
 * The absence column may stay undecided in a jurisdiction that never deducts an unexplained
 * absence (the matrix always has the column; three seeded lineages state nothing in it). It is
 * judged the moment a run prices one: then an undecided cell is the same refusal any other
 * component's would be, reported through VALIDATE and not thrown out of the grid.
 */
test('an undecided absence column refuses only a run that priced an absence', async () => {
	const world = createPublicPayrollWorld();
	world.statutory_contributions.push({
		id: 'scheme',
		settings_id: world.jurisdiction_settings[0].id,
		code: 'FUND',
		sequence: 1,
		special_rules: [],
		relief_for: [],
		rounding: 'NONE',
		bands: [
			{
				selector: { by: 'WAGE', from: 0, to: null },
				award: { kind: 'PERCENT', employee: 11, employer: 13 }
			}
		]
	});
	world.work_catalogue[0].treatments = {
		FUND: {
			salary: { kind: 'INCLUDE' },
			overtime: { kind: 'INCLUDE' },
			overtime_excess: { kind: 'INCLUDE' },
			absence: { kind: 'UNSET' }
		}
	};
	for (const catalogue of [
		world.claim_catalogue,
		world.allowance_catalogue,
		world.payment_catalogue,
		world.loan_catalogue
	])
		for (const row of catalogue) row.contribution_treatments = { FUND: { kind: 'INCLUDE' } };
	// Every rostered day punched over its shift: nothing is absent, so the column is never read.
	const variant = world.shift_definitions[0].variant;
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

	const day = world.work_days.find((row) => row.work_date === '2026-01-05');
	day.worked_intervals = [];
	day.break_minutes = 0;
	await assert.rejects(build, /TREATMENT_UNSET: ABSENCE × FUND is undecided/);
});
