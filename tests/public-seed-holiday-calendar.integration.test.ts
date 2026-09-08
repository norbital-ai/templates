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
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

test(
	'holiday captures seal workdays and payroll atomically, survive deletion and protect successor publication',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-holiday-calendar');
		const collection = 'jurisdiction_holiday_calendars';
		const id = crypto.randomUUID();
		const headers = bearerHeaders(session.credential);
		const write = async (
			values: Record<string, unknown>,
			update = false,
			table: string = collection
		) => {
			const rows = update
				? await session.query(`select row_version from ${table} where id = $1`, [values.id])
				: [];
			const row = rows[0] == null ? null : asRecord(rows[0], 'calendar version');
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
		try {
			const before = await session.query(
				'select id, row_version from jurisdiction_settings order by id'
			);
			requireAccepted(
				(
					await write({
						id,
						jurisdiction_code: 'TEST-JUR',
						year: 2028,
						revision: 1,
						observations: []
					})
				).value,
				'create annual draft'
			);
			const observations = [
				{
					date: '2028-01-03',
					name: 'Observed festival',
					original_date: '2027-12-31',
					source: 'Synthetic fixture'
				}
			];
			requireAccepted(
				(await write({ id, observations, published_at: '2027-12-01T00:00:00Z' }, true)).value,
				'publish complete annual calendar'
			);
			const [published] = await session.query(`select * from ${collection} where id = $1`, [id]);
			assert.ok(published);
			assert.ok(asRecord(published, 'published calendar').published_at);

			for (const change of [
				{ observations: [] },
				{ published_at: null },
				{ year: 2029 },
				{ jurisdiction_code: 'ANOTHER' }
			]) {
				const result = asRecord((await write({ id, ...change }, true)).value, 'published edit');
				assert.equal(result.resolution, 'rejected');
				assert.match(String(result.message ?? result.error), /immutable/i);
			}
			const current = asRecord(published, 'calendar');
			const removal = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, { action: 'delete', collection, ids: [id] }, [
					{ row: { collection, recordId: id }, rowVersion: Number(current.row_version) }
				]),
				headers
			);
			assert.equal(asRecord(removal.value, 'published deletion').resolution, 'rejected');

			requireAccepted(
				(
					await write({
						id: crypto.randomUUID(),
						jurisdiction_code: 'TEST-JUR',
						year: 2028,
						revision: 2,
						observations: [],
						published_at: '2027-12-02T00:00:00Z'
					})
				).value,
				'publish successor'
			);
			const unchanged = await session.query(`select * from ${collection} where id = $1`, [id]);
			assert.deepEqual(
				unchanged[0],
				published,
				'successor retains the original annual publication'
			);
			assert.deepEqual(
				await session.query('select id, row_version from jurisdiction_settings order by id'),
				before,
				'annual publication never changes a settings revision'
			);

			const invalidId = crypto.randomUUID();
			const invalid = asRecord(
				(
					await write({
						id: invalidId,
						jurisdiction_code: 'TEST-JUR',
						year: 2029,
						revision: 1,
						observations,
						published_at: '2028-12-01T00:00:00Z'
					})
				).value,
				'out-of-year publication'
			);
			assert.equal(invalid.resolution, 'rejected');
			assert.equal(
				(await session.query(`select id from ${collection} where id = $1`, [invalidId])).length,
				0,
				'invalid publication is atomic'
			);
			const missingRunId = crypto.randomUUID();
			const missing = asRecord(
				(
					await write(
						{ id: missingRunId, company_id: COMPANY_ID, period: '2029-01' },
						false,
						'payroll_runs'
					)
				).value,
				'missing calendar'
			);
			assert.equal(missing.resolution, 'rejected');
			assert.match(String(missing.message ?? missing.error), /holiday calendar for 2029/);
			assert.equal(
				(await session.query('select id from payroll_runs where id = $1', [missingRunId])).length,
				0
			);

			const runId = crypto.randomUUID();
			requireAccepted(
				(
					await write(
						{ id: runId, company_id: COMPANY_ID, period: '2026-01' },
						false,
						'payroll_runs'
					)
				).value,
				'payroll with annual coverage'
			);
			const run = asRecord(
				(
					await session.query('select holiday_calendars from payroll_runs where id = $1', [runId])
				)[0],
				'frozen calendars'
			);
			const frozen = run.holiday_calendars;
			const capturedDates = await session.query(
				'select calendar_id from holiday_calendar_inputs where payroll_run_id = $1',
				[runId]
			);
			assert.equal(
				capturedDates.length,
				62,
				'December and January dates captured atomically with payroll'
			);
			assert.ok(Array.isArray(frozen));
			assert.deepEqual(
				frozen.map((calendar) => asRecord(calendar, 'annual snapshot').year),
				[2025, 2026]
			);
			assert.deepEqual(
				frozen.map((calendar) => asRecord(calendar, 'annual snapshot').observations),
				[[], []]
			);
			const amendment = {
				jurisdiction_code: 'TEST-JUR',
				year: 2026,
				revision: 2,
				observations: [
					{
						date: '2026-01-01',
						name: 'Amended observation',
						original_date: null,
						source: 'Synthetic amendment'
					}
				],
				published_at: '2026-01-02T00:00:00Z'
			};
			const blocked = asRecord(
				(await write({ id: crypto.randomUUID(), ...amendment })).value,
				'sealed non-holiday'
			);
			assert.equal(blocked.resolution, 'rejected');
			assert.match(String(blocked.message ?? blocked.error), /sealed/);
			const observation = { ...amendment.observations[0]!, date: '2026-02-03' };
			requireAccepted(
				(await write({ id: crypto.randomUUID(), ...amendment, observations: [observation] })).value,
				'amend an unused date'
			);
			const workDayId = crypto.randomUUID();
			requireAccepted(
				(
					await write(
						{
							id: workDayId,
							employment_id: EMPLOYMENT_ID,
							work_date: observation.date,
							worked_intervals: [],
							break_minutes: 0
						},
						false,
						'work_days'
					)
				).value,
				'link a workday before payroll'
			);
			const linkedDay = asRecord(
				(await session.query('select row_version from work_days where id = $1', [workDayId]))[0],
				'linked workday'
			);
			const [workdayCapture] = await session.query(
				'select id, calendar_id from holiday_calendar_inputs where work_day_id = $1',
				[workDayId]
			);
			assert.ok(workdayCapture, 'workday and holiday capture committed together');
			const capturedId = asRecord(workdayCapture, 'workday capture').id;
			const retainedBefore = await session.query(
				'select * from holiday_calendar_inputs where work_day_id = $1',
				[workDayId]
			);
			requireAccepted(
				(await write({ id: workDayId, break_minutes: 0 }, true, 'work_days')).value,
				'edit uncaptured workday without changing its holiday evidence'
			);
			const retainedAfter = await session.query(
				'select * from holiday_calendar_inputs where work_day_id = $1',
				[workDayId]
			);
			assert.equal(retainedAfter.length, 1, 'editing the same date creates no duplicate capture');
			assert.equal(
				asRecord(retainedAfter[0], 'retained capture').calendar_id,
				asRecord(retainedBefore[0], 'original capture').calendar_id
			);
			const latestDay = asRecord(
				(await session.query('select row_version from work_days where id = $1', [workDayId]))[0],
				'updated day'
			);
			linkedDay.row_version = latestDay.row_version;

			const moved = {
				...amendment,
				revision: 3,
				observations: [{ ...observation, date: '2026-02-04' }]
			};
			const movedResult = asRecord(
				(await write({ id: crypto.randomUUID(), ...moved })).value,
				'shift linked holiday'
			);
			assert.equal(movedResult.resolution, 'rejected');
			assert.match(String(movedResult.message ?? movedResult.error), /sealed/);
			const deletedDay = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(
					session.schemaFingerprint,
					{ action: 'delete', collection: 'work_days', ids: [workDayId] },
					[
						{
							row: { collection: 'work_days', recordId: workDayId },
							rowVersion: Number(linkedDay.row_version)
						}
					]
				),
				headers
			);
			requireAccepted(deletedDay.value, 'remove an unconsumed workday');
			assert.equal(
				(await session.query('select id from holiday_calendar_inputs where id = $1', [capturedId]))
					.length,
				1,
				'removing the workday retains its seal'
			);
			assert.equal(
				asRecord((await write({ id: crypto.randomUUID(), ...moved })).value, 'retained seal')
					.resolution,
				'rejected'
			);
			assert.deepEqual(
				asRecord(
					(
						await session.query('select holiday_calendars from payroll_runs where id = $1', [runId])
					)[0],
					'unchanged capture'
				).holiday_calendars,
				frozen
			);
			// A failed graph must leave neither the first workday nor its provisional seal.
			const rollbackDay = crypto.randomUUID();
			const invalidBatch = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'work_days',
					rows: [
						{
							action: 'create',
							values: {
								id: rollbackDay,
								employment_id: EMPLOYMENT_ID,
								work_date: '2026-04-01',
								worked_intervals: [],
								break_minutes: 0
							}
						},
						{
							action: 'create',
							values: {
								id: crypto.randomUUID(),
								employment_id: EMPLOYMENT_ID,
								work_date: '2026-04-02',
								worked_intervals: [],
								break_minutes: -1
							}
						}
					]
				}),
				headers
			);
			assert.equal(asRecord(invalidBatch.value, 'failed workday graph').resolution, 'rejected');
			assert.equal(
				(await session.query('select id from work_days where id = $1', [rollbackDay])).length,
				0
			);
			assert.equal(
				(
					await session.query('select id from holiday_calendar_inputs where work_day_id = $1', [
						rollbackDay
					])
				).length,
				0
			);

			// Either publication wins and the workday captures it, or the empty-read guard
			// rejects a writer. Both accepted with an obsolete classification is forbidden.
			const raceDayId = crypto.randomUUID();
			const raceCalendarId = crypto.randomUUID();
			const raceObservation = {
				...observation,
				date: '2026-04-06',
				name: 'Concurrent announcement'
			};
			const [raceCalendar, raceDay] = await Promise.all([
				write({
					id: raceCalendarId,
					...amendment,
					revision: 3,
					observations: [observation, raceObservation]
				}),
				write(
					{
						id: raceDayId,
						employment_id: EMPLOYMENT_ID,
						work_date: raceObservation.date,
						worked_intervals: [],
						break_minutes: 0
					},
					false,
					'work_days'
				)
			]);
			const publicationResult = asRecord(raceCalendar.value, 'concurrent publication');
			const dayResult = asRecord(raceDay.value, 'concurrent workday');
			for (const result of [publicationResult, dayResult]) {
				assert.ok(
					['accepted', 'rejected'].includes(String(result.resolution)),
					JSON.stringify(result)
				);
				if (result.resolution === 'rejected')
					assert.match(String(result.message ?? result.error), /sealed|changed.*retry/i);
			}
			assert.ok(publicationResult.resolution === 'accepted' || dayResult.resolution === 'accepted');
			const raceCaptures = await session.query(
				'select calendar_id from holiday_calendar_inputs where work_day_id = $1',
				[raceDayId]
			);
			assert.equal(raceCaptures.length, dayResult.resolution === 'accepted' ? 1 : 0);
			if (publicationResult.resolution === 'accepted' && dayResult.resolution === 'accepted')
				assert.equal(asRecord(raceCaptures[0], 'concurrent capture').calendar_id, raceCalendarId);

			const tampered = frozen.map((calendar) => ({
				...asRecord(calendar, 'annual snapshot'),
				revision: 999
			}));
			const changedRun = asRecord(
				(
					await write(
						{ id: runId, lifecycle: 'PAID', holiday_calendars: tampered },
						true,
						'payroll_runs'
					)
				).value,
				'alter captured calendars'
			);
			// Bolt strips columns outside the declared payroll input before hooks. Marking paid is
			// accepted, while the supplied replacement for the captured calendars never reaches storage.
			assert.equal(changedRun.resolution, 'accepted');
			assert.deepEqual(
				asRecord(
					(
						await session.query('select holiday_calendars from payroll_runs where id = $1', [runId])
					)[0],
					'capture after marking paid'
				).holiday_calendars,
				frozen
			);
		} finally {
			await session.stop();
		}
	}
);
