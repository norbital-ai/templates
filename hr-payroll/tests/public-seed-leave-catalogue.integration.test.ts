import test from 'node:test';
import assert from 'node:assert/strict';
import { asRecord, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import {
	approveLeave,
	createLeave,
	leaveBalances,
	leaveTeamHeaders
} from './helpers/public-leave.ts';

const annual = { start: '2026-01-01', end: '2026-12-31' };

test(
	'catalogue queries compute annual availability without generated rows and manual debits reserve until approved',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-leave-catalogue');
		try {
			const catalogue = await session.query(
				'select code, is_statutory, authority from leave_catalogue where settings_id = $1 order by code',
				[JURISDICTION_ID]
			);
			assert.deepEqual(
				catalogue.map((row) => [
					row.code,
					row.is_statutory,
					String(row.authority ?? '').length > 0
				]),
				[
					['ANNUAL', true, true],
					['HOSPITALIZATION', true, true],
					['NS', true, true]
				]
			);
			const entriesBefore = await session.query('select * from leave_entries order by id');
			const sealsBefore = await session.query(
				'select * from employment_contract_inputs order by id'
			);
			for (const asOf of ['2025-12-31', '2026-12-31', '2027-12-31', '2026-12-31']) {
				const balances = await leaveBalances(session, EMPLOYMENT_ID, asOf);
				assert.equal(balances.find((row) => row.code === 'ANNUAL')?.entitlement, 8);
				assert.equal(
					balances.find((row) => row.code === 'ANNUAL')?.balance,
					asOf.startsWith('2026') ? 7 : 8
				);
				assert.equal(balances.find((row) => row.code === 'HOSPITALIZATION')?.balance, 60);
			}
			assert.deepEqual(
				await session.query('select * from leave_entries order by id'),
				entriesBefore
			);
			assert.deepEqual(
				await session.query('select * from employment_contract_inputs order by id'),
				sealsBefore,
				'future projections do not consume contract history'
			);
			const options = {
				id: crypto.randomUUID(),
				reference: 'MANUAL-DEBIT-2026',
				event: {
					kind: 'ADJUSTMENT' as const,
					window: annual,
					days: -2,
					effective_on: '2026-09-01',
					reason: 'Documented external usage'
				}
			};
			const held = await createLeave(session, options, leaveTeamHeaders(session, 'HQ Payroll HR'));
			requireAccepted(held.value, 'held adjustment');
			assert.ok(asRecord(held.value, 'adjustment').pendingApproval);
			const reserved = (await leaveBalances(session, EMPLOYMENT_ID, '2026-12-31')).find(
				(row) => row.code === 'ANNUAL'
			);
			assert.equal(reserved?.balance, 7);
			assert.equal(reserved?.available, 5);
			assert.equal(reserved?.pending, 2);
			const requestId = await approveLeave(session, held.value);
			const replay = await postGuestCommand(
				session.host.baseUrl,
				'collections.resume',
				{ requestId },
				leaveTeamHeaders(session, 'HR Manager')
			);
			assert.equal(replay.status, 200, JSON.stringify(replay.value));
			assert.deepEqual(replay.value, { resumed: true, requestId });
			assert.equal(
				(
					await session.query('select id from leave_entries where reference = $1', [
						options.reference
					])
				).length,
				1
			);
			const posted = (await leaveBalances(session, EMPLOYMENT_ID, '2026-12-31')).find(
				(row) => row.code === 'ANNUAL'
			);
			assert.equal(posted?.balance, 5);
			assert.equal(posted?.pending, 0);
			const duplicate = await createLeave(session, { ...options, id: crypto.randomUUID() });
			assert.match(JSON.stringify(duplicate.value), /reference.*already|already.*reference/i);
			const denied = await createLeave(
				session,
				{ ...options, id: crypto.randomUUID(), reference: 'SELF-DEBIT' },
				leaveTeamHeaders(session, 'Employee')
			);
			assert.notEqual(asRecord(denied.value, 'employee adjustment').resolution, 'accepted');
		} finally {
			await session.stop();
		}
	}
);
