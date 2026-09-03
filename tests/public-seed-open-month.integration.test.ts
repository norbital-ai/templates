import test from 'node:test';
import assert from 'node:assert/strict';
import { asRecord, bearerHeaders, postGuestCommand, rowsOf } from '@norbital-ai/test-utilities';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../src/lib/ui/calendar.ts';
import {
	COMPANY_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	SHIFT_REST_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const payrollDay = (value: unknown): string =>
	calendarDateInTimeZone(new Date(String(value)), PAYROLL_TIME_ZONE);

const openRosterMonth = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	month: string
): Promise<Readonly<Record<string, unknown>>> => {
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
	return asRecord(opened.value, 'invoke.open_roster_month');
};

/**
 * I2 / H1: Open {month} for planning materialises the public Draft month; a mere view writes nothing.
 */
test(
	'public seed open_roster_month is idempotent and viewing writes nothing',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-i2-open');
		try {
			const first = await openRosterMonth(session, FEBRUARY_2026);
			assert.equal(first.state, 'created');
			assert.ok(
				typeof first.created_count === 'number' && first.created_count > 0,
				`expected created_count > 0, got ${JSON.stringify(first)}`
			);
			const rosterId = first.roster_id;
			assert.equal(typeof rosterId, 'string');

			const rosters = (await session.query(
				`select id, month from rosters where company_id = $1 and month = $2`,
				[COMPANY_ID, FEBRUARY_2026]
			)) as ReadonlyArray<{ readonly id: string; readonly month: string }>;
			assert.equal(
				rosters.length,
				1,
				`expected one February roster, got ${JSON.stringify(rosters)}`
			);
			assert.equal(rosters[0]?.id, rosterId);

			const workDays = (await session.query(
				`select id, work_date, shift_definition_id from work_days where roster_id = $1`,
				[rosterId]
			)) as ReadonlyArray<{
				readonly id: string;
				readonly work_date: string;
				readonly shift_definition_id: string | null;
			}>;
			assert.ok(workDays.length > 0, 'expected February work_days after open');
			assert.ok(
				workDays.every((day) => payrollDay(day.work_date).slice(0, 7) === FEBRUARY_2026),
				`work_days outside February: ${JSON.stringify(workDays.map((day) => payrollDay(day.work_date)))}`
			);
			// 2021-05-31 Monday anchor + [6×WORK, REST] → Sunday is REST (2026-02-01).
			const sunday = workDays.find((day) => payrollDay(day.work_date) === '2026-02-01');
			assert.equal(sunday?.shift_definition_id, SHIFT_REST_ID);

			const second = await openRosterMonth(session, FEBRUARY_2026);
			assert.equal(second.state, 'existing');
			assert.equal(second.created_count, 0);
			assert.equal(second.roster_id, rosterId);

			const headers = bearerHeaders(session.credential);
			const viewedRosters = await postGuestCommand(
				session.host.baseUrl,
				'collections.findMany',
				{
					collection: 'rosters',
					where: { company_id: { eq: COMPANY_ID }, month: { eq: FEBRUARY_2026 } },
					limit: 20
				},
				headers
			);
			assert.ok(
				viewedRosters.status >= 200 && viewedRosters.status < 300,
				`rosters findMany ${viewedRosters.status}: ${JSON.stringify(viewedRosters.value)}`
			);
			assert.equal(rowsOf(viewedRosters.value, 'rosters findMany').length, 1);

			const viewedDays = await postGuestCommand(
				session.host.baseUrl,
				'collections.findMany',
				{
					collection: 'work_days',
					where: { roster_id: { eq: rosterId } },
					limit: 250
				},
				headers
			);
			assert.ok(
				viewedDays.status >= 200 && viewedDays.status < 300,
				`work_days findMany ${viewedDays.status}: ${JSON.stringify(viewedDays.value)}`
			);
			assert.ok(rowsOf(viewedDays.value, 'work_days findMany').length > 0);

			const afterView = asRecord(await openRosterMonth(session, FEBRUARY_2026), 'open after view');
			assert.equal(afterView.state, 'existing');
			assert.equal(afterView.created_count, 0);
			const rosterCount = (await session.query(
				`select count(*)::int as n from rosters where company_id = $1`,
				[COMPANY_ID]
			)) as ReadonlyArray<{ readonly n: number }>;
			assert.equal(rosterCount[0]?.n, 1, 'findMany must not create a third roster');
		} finally {
			await session.stop();
		}
	}
);
