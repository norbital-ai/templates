import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAccepted } from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	HOSPITALIZATION_LEAVE_CATALOGUE_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { createLeave, createdLeaveId, leaveBalances } from './helpers/public-leave.ts';

test(
	'hospitalization availability is computed and one approved entry retains its exact dated charges',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-hospitalization');
		try {
			const balances = await leaveBalances(session, EMPLOYMENT_ID, '2026-06-30');
			assert.equal(balances.find((row) => row.code === 'HOSPITALIZATION')?.balance, 60);
			const before = await session.query('select id from leave_entries where employment_id = $1', [
				EMPLOYMENT_ID
			]);
			const created = await createLeave(session, {
				reference: 'HOSPITAL-ADMISSION',
				catalogue_id: HOSPITALIZATION_LEAVE_CATALOGUE_ID,
				from_date: '2026-06-03',
				to_date: '2026-06-04',
				half_day_start: false,
				half_day_end: false,
				days: null,
				reason: 'Admission'
			});
			requireAccepted(created.value, 'hospitalization Leave');
			const id = createdLeaveId(created.value);
			const [stored] = await session.query(
				'select days, charges, allocations from leave_entries where id = $1',
				[id]
			);
			assert.equal(Number(stored.days), 2);
			assert.deepEqual(
				stored.charges.map((row: { date: string; days: number }) => [row.date, row.days]),
				[
					['2026-06-03', 1],
					['2026-06-04', 1]
				]
			);
			assert.equal(
				stored.allocations.reduce((sum: number, row: { days: number }) => sum + row.days, 0),
				-2
			);
			assert.equal(
				(
					await session.query('select id from leave_entries where employment_id = $1', [
						EMPLOYMENT_ID
					])
				).length,
				before.length + 1,
				'approval stores the manual entry without generated opening or debit entries'
			);
			assert.equal(
				(await leaveBalances(session, EMPLOYMENT_ID, '2026-06-30')).find(
					(row) => row.code === 'HOSPITALIZATION'
				)?.balance,
				58
			);
		} finally {
			await session.stop();
		}
	}
);
