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
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * The holiday rule, end to end on the public seed: published means used, unpublished means not
 * there, and the freeze is derived from what points at the row. A work day's pin holds the day and
 * jurisdiction it points at; it does not hold the publication — no payroll run captured this
 * holiday, so unpublishing is allowed and re-saves the pinning day, which re-classifies as an
 * ordinary day. `holiday-lieu.test.ts` asserts the other half: a captured holiday refuses.
 */
test(
	'a published holiday is what a work day pins, and the pin holds its identity',
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
			const holiday = { company_id: '11111111-1111-4111-8111-111111111111', date: '2026-02-03', name: 'Festival' };
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

			// Published: the same date on another day pins the holiday.
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
						company_id: '11111111-1111-4111-8111-111111111111',
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
			// Frozen by reference: the day and the jurisdiction are what the pin points at.
			for (const change of [{ date: '2026-02-05' }, { company_id: '22222222-2222-4222-8222-222222222222' }]) {
				const refused = asRecord(
					(await write('jurisdiction_holidays', { id: publishedId, ...change }, true)).value,
					'move a pinned holiday'
				);
				assert.equal(refused.resolution, 'rejected', JSON.stringify(change));
				assert.match(String(refused.message ?? refused.error), /pinned by 1 work day/);
			}
			// A name is not what a pin points at, so it still changes.
			requireAccepted(
				(await write('jurisdiction_holidays', { id: publishedId, name: 'Renamed' }, true)).value,
				'rename a pinned holiday'
			);

			// No payroll run captured it, so the publication is not frozen: unpublishing re-saves the
			// pinning day, which re-classifies as an ordinary day and releases the holiday.
			requireAccepted(
				(await write('jurisdiction_holidays', { id: publishedId, published_at: null }, true)).value,
				'unpublish a pinned holiday'
			);
			assert.equal(
				asRecord(
					(
						await session.query('select holiday_id from work_days where id = $1', [holidayDayId])
					)[0],
					'holiday day after retraction'
				).holiday_id,
				null,
				'the pin goes with the publication that earned it'
			);

			// Nothing points at it any more, so it can go.
			const current = await stored(publishedId);
			requireAccepted(
				(
					await postGuestCommand(
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
					)
				).value,
				'delete a released holiday'
			);
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
