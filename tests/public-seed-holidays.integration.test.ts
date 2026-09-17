import assert from 'node:assert/strict';
import test from 'node:test';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import { createdIds, observedVersion, writeRows } from './helpers/write.ts';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * The holiday rule, end to end on the public seed: a holiday is a property of the entity's
 * calendar, overlaid on a date when a day is read. A work day stores nothing about it — there is
 * no column to pin with — so work days on the date hold nothing still: the holiday moves,
 * unpublishes and goes while no payroll run has captured it. `holiday-lieu.test.ts` asserts the
 * other half: a captured holiday refuses.
 */
test(
	'a holiday is overlaid by date: work days pin nothing and never hold a holiday still',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-holidays');
		const headers = bearerHeaders(session.credential);
		const write = async (table: string, values: Record<string, unknown>, update = false) => {
			const rows = update
				? await session.query(`select row_version from ${table} where id = $1`, [values.id])
				: [];
			const row = rows[0] == null ? null : asRecord(rows[0], 'row version');
			return writeRows(
				session,
				table,
				update ? 'update' : 'create',
				[values],
				headers,
				row == null ? [] : [observedVersion(table, String(values.id), Number(row.row_version))]
			);
		};
		const stored = async (id: string) =>
			asRecord(
				(await session.query('select * from jurisdiction_holidays where id = $1', [id]))[0],
				'holiday'
			);
		try {
			// The negative, checked against a positive from the same query: the plan column is
			// there, the pin column is not.
			const columns = (await session.query(
				`select column_name from information_schema.columns
				 where table_name = 'work_days' and column_name in ('holiday_id', 'shift_definition_id')`
			)) as ReadonlyArray<{ readonly column_name: string }>;
			assert.deepEqual(
				columns.map((row) => row.column_name),
				['shift_definition_id'],
				'a work day has no holiday column'
			);

			const holiday = {
				company_id: '11111111-1111-4111-8111-111111111111',
				date: '2026-02-03',
				name: 'Festival'
			};
			const added = await write('jurisdiction_holidays', holiday);
			requireAccepted(added.value, 'add');
			const [draftId] = createdIds(added.value);
			assert.equal((await stored(draftId)).published_at, null, 'a new holiday is unpublished');

			// A work day on the date lands whether or not the holiday is published: it is a day.
			const punched = await write('work_days', {
				employment_id: EMPLOYMENT_ID,
				work_date: holiday.date,
				worked_intervals: []
			});
			requireAccepted(punched.value, 'work day on the holiday date');
			const [dayId] = createdIds(punched.value);

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
				(await write('jurisdiction_holidays', holiday)).value,
				'second holiday on one day'
			);
			assert.ok(
				duplicate.resolution === 'rejected' || duplicate.resolution === 'quarantined',
				`one row per jurisdiction and day: ${JSON.stringify(duplicate)}`
			);

			// Nothing points at the published holiday but the calendar date itself, so with a work
			// day sitting on it the row still moves, is renamed, unpublishes, and goes.
			for (const change of [
				{ date: '2026-02-05' },
				{ date: holiday.date },
				{ name: 'Renamed' },
				{ published_at: null }
			]) {
				requireAccepted(
					(await write('jurisdiction_holidays', { id: draftId, ...change }, true)).value,
					`change ${JSON.stringify(change)} with a work day on the date`
				);
			}
			const current = await stored(draftId);
			requireAccepted(
				(
					await writeRows(session, 'jurisdiction_holidays', 'delete', [{ id: draftId }], headers, [
						observedVersion('jurisdiction_holidays', draftId, Number(current.row_version))
					])
				).value,
				'delete a holiday a work day sits on'
			);
			// The day is exactly what it was: nothing on it changed hands with the calendar.
			const day = asRecord(
				(
					await session.query(
						'select employment_id, worked_intervals from work_days where id = $1',
						[dayId]
					)
				)[0],
				'work day after the holiday went'
			);
			assert.equal(day.employment_id, EMPLOYMENT_ID);
			assert.deepEqual(day.worked_intervals, []);
		} finally {
			await session.stop();
		}
	}
);
