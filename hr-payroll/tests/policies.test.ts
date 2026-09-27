// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The access ladder as declared (the policies are data the engine judges). Every team names shipped policies; the
 * settings root is drafted by a controller and sealed or voided under review; a kiosk enrols only pending people and
 * never undoes an approval; each former server function is granted to the policies whose holders call it.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import teams from '../src/access/+team.ts';
import { DRAFT_VERSION, SEAL_CREATE_APPROVAL, SEAL_UPDATE_APPROVAL } from '../src/access/grants.ts';

const dir = new URL('../src/access/', import.meta.url);
const policies = Object.fromEntries(
	await Promise.all(
		readdirSync(dir)
			.filter((file) => file.endsWith('.policy.ts'))
			.map(async (file) => [
				file.slice(1, -'.policy.ts'.length),
				(await import(new URL(file, dir).href)).default
			])
	)
);

test('every team holds policies this workspace ships', () => {
	for (const [team, held] of Object.entries(teams))
		for (const name of held) assert.ok(policies[name], `${team} holds unknown policy ${name}`);
});

test('a controller drafts settings versions; the HR Manager and Senior Management seal and void under review', () => {
	const { hr_controller, hr_manager, senior_management, manager } = policies;
	assert.deepEqual(
		[
			hr_controller.grants.jurisdiction_settings.create,
			hr_controller.grants.jurisdiction_settings.update
		],
		[DRAFT_VERSION, DRAFT_VERSION]
	);
	for (const policy of [hr_manager, senior_management]) {
		assert.equal(policy.grants.jurisdiction_settings.create.approval, SEAL_CREATE_APPROVAL);
		assert.equal(policy.grants.jurisdiction_settings.update.approval, SEAL_UPDATE_APPROVAL);
		assert.deepEqual(policy.grants.jurisdiction_settings.delete, { sealed_at: { isNull: true } });
	}
	assert.deepEqual(SEAL_UPDATE_APPROVAL.steps, [['HR Manager', 'Senior Management']]);
	assert.equal(manager.grants.jurisdiction_settings.update, undefined);
});

test('a kiosk creates people only PENDING and may refresh, never undo, an approved face', () => {
	const { employees } = policies.kiosk.grants;
	assert.deepEqual(employees.create.where, { face_enrollment_status: { eq: 'PENDING' } });
	assert.deepEqual(employees.update.previous, {
		face_enrollment_status: { in: ['NONE', 'APPROVED'] }
	});
	assert.deepEqual(employees.update.where, { face_enrollment_status: { eq: 'APPROVED' } });
	assert.ok(!employees.create.fields.includes('children'));
});

test('each former function reaches exactly the policies whose holders call it', () => {
	const holders = (collection, kind, name) =>
		Object.keys(policies)
			.filter((policy) => policies[policy].grants[collection]?.[kind]?.includes(name))
			.sort();
	assert.deepEqual(holders('jurisdiction_settings', 'actions', 'new_settings_version'), [
		'hr_controller',
		'hr_manager',
		'manager'
	]);
	for (const [kind, name] of [
		['queries', 'kiosk_match'],
		['actions', 'kiosk_enroll']
	])
		assert.deepEqual(holders('employees', kind, name), [
			'hr_controller',
			'hr_manager',
			'kiosk',
			'manager'
		]);
	assert.deepEqual(holders('jurisdiction_holidays', 'actions', 'import_workbook'), [
		'hr_controller',
		'hr_manager',
		'senior_management'
	]);
});

test('payroll runs: ranks below HR never create one, a controller’s is held, HR Manager and Senior Management run it', () => {
	for (const rank of ['employee', 'supervisor', 'manager'])
		assert.equal(policies[rank].grants.payroll_runs.create, undefined);
	assert.deepEqual(policies.hr_controller.grants.payroll_runs.create.approval.steps, [
		['HR Manager', 'Senior Management']
	]);
	for (const rank of ['hr_manager', 'senior_management'])
		assert.equal(policies[rank].grants.payroll_runs.create, true);
});

test('below HR, a person raises only time off, and only about themselves as an employee', () => {
	for (const rank of ['employee', 'supervisor', 'manager'])
		assert.deepEqual(policies[rank].grants.leave_entries.create.where.activity, { eq: 'TIME_OFF' });
	assert.ok(policies.employee.grants.leave_entries.create.where.employment_id);
});
