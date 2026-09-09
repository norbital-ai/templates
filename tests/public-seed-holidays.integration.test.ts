import assert from 'node:assert/strict';
import test from 'node:test';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * The holiday rule, end to end on the public seed: published means used, unpublished means not
 * there, a pin holds the day, and a payroll run capturing the holiday freezes it.
 */
test(
	'a published holiday is what a work day pins, and the pin freezes the holiday',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-holidays');
		const headers = bearerHeaders(session.credential);
		const write = async (table: string, values: Record<string, unknown>, update = false) => {
			const rows = update
				? await session.query(`select row_version from ${table} where id = $1`, [values.id])
				: [];
			const row = rows[0] == null ? null : asRecord(rows[0], 'row version');
			return postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(
					session.schemaFingerprint,
					{
						action: 'mutate',
						collection: table,
						rows: [{ action: update ? 'update' : 'create', values }]
					},
					row == null
						? []
						: [
								{
									row: { collection: table, recordId: String(values.id) },
									rowVersion: Number(row.row_version)
								}
							]
				),
				headers
			);
		};
		const stored = async (id: string) =>
			asRecord(
				(await session.query('select * from jurisdiction_holidays where id = $1', [id]))[0],
				'holiday'
			);
		try {
			const draftId = crypto.randomUUID();
			const holiday = { jurisdiction_code: 'TEST-JUR', date: '2026-02-03', name: 'Festival' };
			requireAccepted(
				(await write('jurisdiction_holidays', { id: draftId, ...holiday })).value,
				'add'
			);
			assert.equal((await stored(draftId)).published_at, null, 'a new holiday is unpublished');

			// Unpublished: a work day on the date is an ordinary day and pins nothing.
			const ordinaryDayId = crypto.randomUUID();
			requireAccepted(
				(
					await write('work_days', {
						id: ordinaryDayId,
						employment_id: EMPLOYMENT_ID,
						work_date: holiday.date,
						worked_intervals: [],
						break_minutes: 0
					})
				).value,
				'work day before publication'
			);
			assert.equal(
				asRecord(
					(
						await session.query('select holiday_id from work_days where id = $1', [ordinaryDayId])
					)[0],
					'ordinary day'
				).holiday_id,
				null
			);

			// Published: the same date on another day pins the holiday, which is consumed from then on.
			requireAccepted(
				(
					await write(
						'jurisdiction_holidays',
						{ id: draftId, published_at: '2026-01-01T00:00:00Z' },
						true
					)
				).value,
				'publish'
			);
			const duplicate = asRecord(
				(await write('jurisdiction_holidays', { id: crypto.randomUUID(), ...holiday })).value,
				'second holiday on one day'
			);
			assert.ok(
				duplicate.resolution === 'rejected' || duplicate.resolution === 'quarantined',
				`one row per jurisdiction and day: ${JSON.stringify(duplicate)}`
			);
			// A published holiday on another day: the same employment's work day on it pins it.
			const publishedId = crypto.randomUUID();
			requireAccepted(
				(
					await write('jurisdiction_holidays', {
						id: publishedId,
						jurisdiction_code: 'TEST-JUR',
						date: '2026-02-04',
						name: 'Festival, day two',
						published_at: '2026-01-01T00:00:00Z'
					})
				).value,
				'add a published holiday'
			);
			const holidayDayId = crypto.randomUUID();
			requireAccepted(
				(
					await write('work_days', {
						id: holidayDayId,
						employment_id: EMPLOYMENT_ID,
						work_date: '2026-02-04',
						worked_intervals: [],
						break_minutes: 0
					})
				).value,
				'work day after publication'
			);
			assert.equal(
				asRecord(
					(
						await session.query('select holiday_id from work_days where id = $1', [holidayDayId])
					)[0],
					'holiday day'
				).holiday_id,
				publishedId,
				'the day pins the published holiday'
			);
			assert.ok((await stored(publishedId)).published_at, 'the pin leaves publication alone');
			// A pinned day's date cannot move: the pins point at this day in this jurisdiction.
			const pinnedMove = asRecord(
				(await write('jurisdiction_holidays', { id: publishedId, date: '2026-02-05' }, true)).value,
				'move a pinned holiday'
			);
			assert.equal(pinnedMove.resolution, 'rejected', JSON.stringify(pinnedMove));
			assert.match(String(pinnedMove.message ?? pinnedMove.error), /pinned/);

			// Captured: a payroll run over February snapshots the holiday, freezing it.
			const payrollRunId = crypto.randomUUID();
			requireAccepted(
				(
					await postGuestCommand(
						session.host.baseUrl,
						'collections.mutate',
						mutationPush(session.schemaFingerprint, {
							action: 'mutate',
							collection: 'payroll_runs',
							rows: [
								{
									action: 'create',
									values: { id: payrollRunId, company_id: COMPANY_ID, period: FEBRUARY_2026 }
								}
							]
						}),
						headers
					)
				).value,
				'create the February run'
			);
			const payslips = (await session.query('select id from payslips where payroll_run_id = $1', [
				payrollRunId
			])) as ReadonlyArray<{ readonly id: string }>;
			assert.ok(payslips.length > 0, 'the February run built payslips');

			// Frozen: neither the name, the day, the publication nor the row itself may move now.
			for (const change of [{ name: 'Renamed' }, { date: '2026-02-05' }, { published_at: null }]) {
				const refused = asRecord(
					(await write('jurisdiction_holidays', { id: publishedId, ...change }, true)).value,
					'edit a captured holiday'
				);
				assert.equal(refused.resolution, 'rejected', JSON.stringify(change));
				assert.match(String(refused.message ?? refused.error), /cannot/);
			}
			const current = await stored(publishedId);
			const removal = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(
					session.schemaFingerprint,
					{ action: 'delete', collection: 'jurisdiction_holidays', ids: [publishedId] },
					[
						{
							row: { collection: 'jurisdiction_holidays', recordId: publishedId },
							rowVersion: Number(current.row_version)
						}
					]
				),
				headers
			);
			assert.equal(asRecord(removal.value, 'delete a captured holiday').resolution, 'rejected');
			// The earlier ordinary day keeps what it was: the pin, not the publication, is the day's truth.
			assert.equal(
				asRecord(
					(
						await session.query('select holiday_id from work_days where id = $1', [ordinaryDayId])
					)[0],
					'ordinary day after publication'
				).holiday_id,
				null
			);
		} finally {
			await session.stop();
		}
	}
);
