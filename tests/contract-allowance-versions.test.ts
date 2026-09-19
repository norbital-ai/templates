// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A contract lists an allowance class by the row of the version it was signed under. A later
 * sealed version clones the row under a new id: the class is its code, and the period's version
 * prices it. A version that drops the code pays nothing and says so.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRun, payslipsOf } from './helpers/settlement.ts';
import {
	JURISDICTION_ID,
	TRANSPORT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';

const VERSION_2 = '22222222-2222-4222-8222-222222222223';
const TRANSPORT_V2 = '77777777-7777-4777-8777-777777777779';

/** The lineage re-sealed from February: version 1 closes, version 2 carries the classes given. */
function reseal(world, classes) {
	const [first] = world.jurisdiction_settings;
	first.effective_range = { start: '2020-01-01', end: '2026-02-01' };
	world.jurisdiction_settings.push({
		...structuredClone(first),
		id: VERSION_2,
		cloned_from_id: first.id,
		effective_range: { start: '2026-02-01', end: null }
	});
	for (const table of [
		'allowance_catalogue',
		'adhoc_catalogue',
		'claim_catalogue',
		'leave_catalogue',
		'statutory_contributions',
		'loan_catalogue'
	])
		for (const row of [...world[table]])
			if (row.settings_id === JURISDICTION_ID && table !== 'allowance_catalogue')
				world[table].push({
					...structuredClone(row),
					id: crypto.randomUUID(),
					settings_id: VERSION_2
				});
	world.allowance_catalogue.push(...classes);
	for (const day of world.work_days)
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
}

const transportOf = (payload) =>
	payslipsOf(payload)[0].base.find((line) => line.component_code === 'TRANSPORT')?.amount;

test('the period version prices a class the contract lists under an earlier version', async () => {
	const world = createPublicPayrollWorld();
	const [v1] = world.allowance_catalogue;
	reseal(world, [
		{
			...structuredClone(v1),
			id: TRANSPORT_V2,
			settings_id: VERSION_2,
			bands: [{ when: '', amount: 'entry.amount + 40.0', limit: null }]
		}
	]);
	assert.equal(world.employment_terms[0].allowances[0].catalogue_id, TRANSPORT_ID);
	const january = await createRun(world, '2026-01');
	assert.equal(transportOf(january), 310, 'January prices under version 1');
	const february = await createRun(world, '2026-02');
	assert.equal(transportOf(february), 350, 'February prices the same listing by version 2 bands');
	assert.equal(february.warnings.includes('ALLOWANCE_SKIPPED'), false);
});

test('a version that drops the class pays nothing for the listing and reports it', async () => {
	const world = createPublicPayrollWorld();
	reseal(world, []);
	const february = await createRun(world, '2026-02');
	assert.equal(transportOf(february), undefined);
	assert.match(february.warnings, /ALLOWANCE_SKIPPED: .*does not offer/);
});
