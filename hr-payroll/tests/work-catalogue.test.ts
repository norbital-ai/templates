import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { accumulateBases } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { COMPANY_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

test('Work uses stored rules and output codes, and refuses a missing catalogue', async () => {
	const world = createPublicPayrollWorld();
	world.work_catalogue[0].salary.code = 'CONTRACT_PAY';
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const payslips = buildPayrollRun(prepared).payslip_payroll_run;
	assert.equal(payslips.length, 1);
	assert.equal(payslips[0].base.find((row) => row.component_code === 'CONTRACT_PAY')?.amount, 3451);
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
	for (const key of ['salary', 'overtime', 'overtime_excess', 'absence']) {
		world.work_catalogue[0][key].contribution_treatments = {
			FUND: {
				kind: key === 'absence' ? 'REDUCE' : key === 'overtime_excess' ? 'EXCLUDE' : 'INCLUDE'
			}
		};
	}
	world.work_catalogue[0].overtime.code = 'EXTRA_HOURS';
	const { configuration } = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const items = configuration.catalogueComponents
		.filter((row) => row.family === 'WORK')
		.map((row) => ({
			catalogueComponent: row,
			nature: row.policy.kind,
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
		/No FUND treatment exists for EXTRA_HOURS/
	);
});
