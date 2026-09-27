/**
 * Who may write which half of a work day: below HR only the clock (attendance, reviewed), never the plan; the HR ranks
 * and Senior Management both halves; everyone reads the whole day.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import employee from '../src/access/+employee.policy.ts';
import supervisor from '../src/access/+supervisor.policy.ts';
import manager from '../src/access/+manager.policy.ts';
import seniorManagement from '../src/access/+senior_management.policy.ts';
import hrController from '../src/access/+hr_controller.policy.ts';
import hrManager from '../src/access/+hr_manager.policy.ts';
import { WORK_DAY_ATTENDANCE_FIELDS, WORK_DAY_FULL_FIELDS } from '../src/access/grants.ts';

type Grant = { readonly fields?: readonly string[]; readonly approval?: unknown };
const workDays = (p: { spec?: unknown }) =>
	(
		((p as { spec?: { grants?: object } }).spec ?? p) as {
			grants: { work_days: Record<string, unknown> };
		}
	).grants.work_days;

test('below HR a work-day write touches only attendance, and is reviewed', () => {
	for (const policy of [employee, supervisor, manager])
		for (const op of ['create', 'update'] as const) {
			const grant = workDays(policy)[op] as Grant;
			assert.ok(grant.approval !== undefined, `${op} is reviewed`);
			assert.ok(
				(grant.fields ?? []).every((f) =>
					(WORK_DAY_ATTENDANCE_FIELDS as readonly string[]).includes(f)
				),
				`${op} names only attendance fields: ${grant.fields}`
			);
		}
});

test('the HR ranks and Senior Management write both halves; everyone reads the whole day', () => {
	for (const policy of [seniorManagement, hrController, hrManager])
		for (const op of ['create', 'update'] as const)
			assert.deepEqual((workDays(policy)[op] as Grant).fields, WORK_DAY_FULL_FIELDS);
	for (const policy of [supervisor, manager, seniorManagement, hrController, hrManager])
		assert.equal(workDays(policy).read, true);
});
