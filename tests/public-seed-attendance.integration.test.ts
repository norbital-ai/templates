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
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	SHIFT_REST_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const openRosterMonth = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	month: string
): Promise<void> => {
	const opened = await postGuestCommand(
		session.host.baseUrl,
		'invoke.open_roster_month',
		{ input: { company_id: COMPANY_ID, month } },
		bearerHeaders(session.credential)
	);
	if (opened.status < 200 || opened.status >= 300) {
		throw new Error(
			`invoke.open_roster_month returned ${opened.status}: ${JSON.stringify(opened.value)}`
		);
	}
};

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
 */
test(
	'public seed attendance save stores empty intervals without quarantining',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-i2-attendance');
		try {
			await openRosterMonth(session, FEBRUARY_2026);
			const headers = bearerHeaders(session.credential);
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
			assert.ok(days.length > 0, 'expected PUB-EMP-0001 February work_days');

			const unread = days.filter((day) => day.worked_intervals == null);
			assert.ok(unread.length >= 2, 'need two unread days so one can stay null');
			const restDay =
				unread.find((day) => day.shift_definition_id === SHIFT_REST_ID) ?? unread[0];
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
						action: 'update',
						collection: 'work_days',
						values: {
							id: restDay.id,
							worked_intervals: [],
							break_minutes: 0
						}
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
