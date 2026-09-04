import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted,
	rowsOf
} from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const WORK_DAY_LIVE_COLUMNS = {
	id: true,
	row_version: true,
	worked_intervals: true,
	break_minutes: true,
	work_date: true,
	shift_definition_id: true
};

/**
 * I2 / H3 / A1 / A4: one person-day save keeps null ≠ []. Quarantined is the A1 defect.
 *
 * No month is opened first: a roster row is an override, and attendance needs no roster.
 * The two February person-days are created bare, then one is marked absent (`[]`) while the
 * other stays unrecorded (`null`).
 */
test(
	'public seed attendance save stores empty intervals without quarantining',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-i2-attendance');
		try {
			const headers = bearerHeaders(session.credential);
			const created = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(
					session.schemaFingerprint,
					{
						action: 'mutate',
						collection: 'work_days',
						rows: [
							{
								action: 'create',
								values: {
									id: crypto.randomUUID(),
									employment_id: EMPLOYMENT_ID,
									work_date: '2026-02-03'
								}
							},
							{
								action: 'create',
								values: {
									id: crypto.randomUUID(),
									employment_id: EMPLOYMENT_ID,
									work_date: '2026-02-04'
								}
							}
						]
					},
					[]
				),
				headers
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`work_days create ${created.status}: ${JSON.stringify(created.value)}`
			);
			requireAccepted(created.value, 'work_days attendance create');

			const listed = await postGuestCommand(
				session.host.baseUrl,
				'collections.findMany',
				{
					collection: 'work_days',
					where: { employment_id: { eq: EMPLOYMENT_ID } },
					columns: WORK_DAY_LIVE_COLUMNS,
					limit: 50
				},
				headers
			);
			assert.ok(
				listed.status >= 200 && listed.status < 300,
				`work_days findMany ${listed.status}: ${JSON.stringify(listed.value)}`
			);
			const days = rowsOf(listed.value, 'PUB-EMP-0001 work_days');
			assert.ok(days.length >= 2, 'expected PUB-EMP-0001 February work_days');

			const unread = days.filter((day) => day.worked_intervals == null);
			assert.ok(unread.length >= 2, 'need two unread days so one can stay null');
			const restDay = unread[0];
			const untouched = unread.find((day) => day.id !== restDay?.id);
			assert.ok(restDay && typeof restDay.id === 'string');
			assert.ok(untouched && typeof untouched.id === 'string');
			assert.equal(typeof restDay.row_version, 'number', JSON.stringify(restDay));

			const updated = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(
					session.schemaFingerprint,
					{
						action: 'mutate',
						collection: 'work_days',
						rows: [
							{
								action: 'update',
								values: {
									id: restDay.id,
									worked_intervals: [],
									break_minutes: 0
								}
							}
						]
					},
					[
						{
							row: { collection: 'work_days', recordId: restDay.id },
							rowVersion: restDay.row_version
						}
					]
				),
				headers
			);
			assert.ok(
				updated.status >= 200 && updated.status < 300,
				`work_days mutate ${updated.status}: ${JSON.stringify(updated.value)}`
			);
			requireAccepted(updated.value, 'work_days attendance save');

			const reloaded = await postGuestCommand(
				session.host.baseUrl,
				'collections.findMany',
				{
					collection: 'work_days',
					where: { employment_id: { eq: EMPLOYMENT_ID } },
					columns: WORK_DAY_LIVE_COLUMNS,
					limit: 50
				},
				headers
			);
			const after = rowsOf(reloaded.value, 'reloaded work_days');
			const saved = after.find((day) => day.id === restDay.id);
			const stillUnread = after.find((day) => day.id === untouched.id);
			assert.ok(saved, 'saved day missing after reload');
			assert.ok(stillUnread, 'untouched day missing after reload');
			assert.deepEqual(saved.worked_intervals, []);
			assert.equal(stillUnread.worked_intervals, null);
			assert.equal(asRecord(saved, 'saved day').id, restDay.id);
		} finally {
			await session.stop();
		}
	}
);
