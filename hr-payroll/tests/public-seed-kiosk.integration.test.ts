import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../src/lib/iso-day.ts';
import { startOfDayInstant } from '../src/lib/ui/calendar.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	SHIFT_REST_ID,
	SHIFT_WORK_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

test(
	'kiosk can enroll and re-enroll, preserves the first arrival and last confirmed departure',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-kiosk');
		try {
			// The kiosk resolves its model base from the chunk's own URL (`../models/human/` beside
			// `assets/`), because a hosted release is served only under a versioned static root. The
			// proof is end to end on this host: find the built chunk that carries the reference, fetch
			// it from where the host serves the bundle, then fetch every model pair through the same
			// relative resolution the browser performs from that chunk's URL.
			const assetsDirectory = new URL('../.norbital/dist/assets/', import.meta.url);
			const chunks = (await readdir(assetsDirectory)).filter((name) => name.endsWith('.js'));
			const chunkSources = await Promise.all(
				chunks.map(async (name) => [name, await readFile(new URL(name, assetsDirectory), 'utf8')])
			);
			const modelChunk = chunkSources.find(([, source]) => source.includes('../models/human/'));
			assert.ok(modelChunk, 'one built chunk under assets/ references ../models/human/');
			assert.match(
				modelChunk[1]!,
				/import\.meta\.url/,
				'the model base is resolved from the chunk URL, not a fixed path'
			);
			const chunkUrl = `${session.host.baseUrl}/__bolt/static/assets/${modelChunk[0]}`;
			const served = await fetch(chunkUrl, { headers: bearerHeaders(session.credential) });
			assert.equal(served.status, 200, `Published chunk ${modelChunk[0]}`);
			const modelBase = new URL('../models/human/', chunkUrl);
			assert.equal(modelBase.pathname, '/__bolt/static/models/human/');
			for (const model of ['antispoof', 'blazeface', 'facemesh', 'faceres', 'iris', 'liveness']) {
				for (const suffix of ['.json', '.bin']) {
					const response = await fetch(new URL(`${model}${suffix}`, modelBase), {
						headers: bearerHeaders(session.credential)
					});
					assert.equal(response.status, 200, `Published face model ${model}${suffix}`);
					const packaged = await readFile(
						new URL(`../node_modules/@vladmandic/human/models/${model}${suffix}`, import.meta.url)
					);
					assert.deepEqual(Buffer.from(await response.arrayBuffer()), packaged);
				}
			}
			const headers = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'Attendance Kiosk'
			};
			const invoke = (name: string, input: unknown) =>
				postGuestCommand(session.host.baseUrl, `invoke.${name}`, { input }, headers);
			const employeeId = '33333333-3333-4333-8333-333333333333';
			const embedding = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
			const enrolled = await invoke('kiosk_enroll', {
				employee_id: employeeId,
				face_embedding: embedding,
				consent_at: '2026-01-01T00:00:00Z'
			});
			assert.equal(
				asRecord(enrolled.value, 'enrollment').status,
				'APPROVED',
				JSON.stringify(enrolled.value)
			);
			const reregistered = await invoke('kiosk_enroll', {
				employee_id: employeeId,
				face_embedding: embedding.map((value) => value * 0.9),
				consent_at: '2026-01-01T00:00:00Z'
			});
			assert.equal(
				asRecord(reregistered.value, 're-enrollment').status,
				'APPROVED',
				JSON.stringify(reregistered.value)
			);
			/**
			 * A face punch needs a plan for the day, and the day is whatever day the test runs on.
			 *
			 * The kiosk now refuses to record attendance against a day nobody rostered — that was the
			 * whole point of the change, and it is what stops a punch inventing a plan-less work day
			 * for a rest day or somebody else's shift. It also makes "today" load-bearing: the fixture
			 * pattern rests every seventh day from its anchor, so a test that leaned on the projection
			 * would pass six days a week and fail on the seventh. Every case below states the day's
			 * plan explicitly instead.
			 */
			const dayKey = calendarDateInTimeZone(new Date(), PAYROLL_TIME_ZONE);
			const workDate = startOfDayInstant(dayKey, PAYROLL_TIME_ZONE);
			const planToday = async (shiftDefinitionId: string | null): Promise<void> => {
				await session.query('delete from work_days where employment_id = $1 and work_date = $2', [
					EMPLOYMENT_ID,
					workDate
				]);
				if (shiftDefinitionId === null) return;
				await session.query(
					`insert into work_days (id, employment_id, work_date, shift_definition_id, break_minutes)
					 values ($1, $2, $3, $4, 0)`,
					[crypto.randomUUID(), EMPLOYMENT_ID, workDate, shiftDefinitionId]
				);
			};
			/**
			 * Ten seconds of debounce separate two real punches; a test does not wait them out.
			 *
			 * The cooldown reads `employees.face_last_match_at`, which a successful face punch stamps.
			 * Clearing it is how this test says "later that day" — and it keeps the FACE path, and
			 * therefore the schedule gate, under test rather than dropping to MANUAL to dodge it.
			 */
			const laterThatDay = () =>
				session.query('update employees set face_last_match_at = null where id = $1', [employeeId]);
			const punch = async (kind: 'FACE' | 'MANUAL' = 'FACE') => {
				const result = await invoke('kiosk_punch', { employment_id: EMPLOYMENT_ID, kind });
				return asRecord(result.value, `${kind} punch`);
			};

			// No plan at all: the person is not rostered today, which is not an error.
			await planToday(null);
			// The terms' pattern would otherwise project one, so it is removed for this case only.
			const [terms] = (await session.query(
				'select shift_pattern_id from employment_terms where employment_id = $1',
				[EMPLOYMENT_ID]
			)) as ReadonlyArray<{ readonly shift_pattern_id: string | null }>;
			await session.query(
				'update employment_terms set shift_pattern_id = null where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			const unrostered = await punch();
			assert.equal(unrostered.status, 'blocked', JSON.stringify(unrostered));
			assert.equal(unrostered.reason, 'not-scheduled', JSON.stringify(unrostered));
			assert.equal(
				(
					await session.query('select count(*)::int as n from work_days where employment_id = $1', [
						EMPLOYMENT_ID
					])
				)[0].n,
				0,
				'a refused punch invented a work day anyway'
			);

			// The supervisor path is untouched: an ad hoc day entered by hand still lands.
			const adHoc = await punch('MANUAL');
			assert.equal(adHoc.status, 'in', JSON.stringify(adHoc));
			await session.query(
				'update employment_terms set shift_pattern_id = $2 where employment_id = $1',
				[EMPLOYMENT_ID, terms?.shift_pattern_id ?? null]
			);

			// Rostered, but rostered to rest. The refusal names the code so the screen can say which.
			await planToday(SHIFT_REST_ID);
			const restDay = await punch();
			assert.equal(restDay.status, 'blocked', JSON.stringify(restDay));
			assert.equal(restDay.reason, 'not-a-work-day', JSON.stringify(restDay));
			assert.equal(restDay.plannedCode, 'REST', JSON.stringify(restDay));

			// Rostered to work: the punch lands, and every later one moves the departure.
			await planToday(SHIFT_WORK_ID);
			const first = await punch();
			assert.equal(first.status, 'in', JSON.stringify(first));

			// The debounce, before it is cleared: a face held at the camera is one arrival, not two.
			const debounced = await punch();
			assert.equal(debounced.status, 'blocked', JSON.stringify(debounced));
			assert.equal(debounced.reason, 'cooldown', JSON.stringify(debounced));

			await laterThatDay();
			const out = await punch();
			assert.equal(out.status, 'out', JSON.stringify(out));
			await laterThatDay();
			const later = await punch();
			assert.equal(later.status, 'out', JSON.stringify(later));

			const [day] = await session.query(
				'select worked_intervals from work_days where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			assert.deepEqual(
				day.worked_intervals,
				[{ start: first.time, end: later.time }],
				'the day keeps one interval: its first arrival and its latest departure'
			);

			await laterThatDay();
			/**
			 * Six punches at once must not produce six intervals.
			 *
			 * The debounce means most of them are blocked, which is the right answer — a face held at
			 * the camera is one punch. What matters is that the racing writers cannot corrupt the day:
			 * whatever mixture of accepted and blocked comes back, the day still holds exactly one
			 * interval, opened by the first arrival and ending at the latest punch that was accepted.
			 */
			const concurrent = await Promise.all(Array.from({ length: 6 }, () => punch()));
			for (const result of concurrent) {
				assert.ok(
					result.status === 'out' || result.status === 'blocked',
					`a concurrent punch neither recorded nor debounced: ${JSON.stringify(result)}`
				);
			}
			const accepted = concurrent
				.flatMap((row) => (typeof row.time === 'string' ? [row.time] : []))
				.toSorted();
			const [concurrentDay] = await session.query(
				'select worked_intervals from work_days where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			assert.deepEqual(concurrentDay.worked_intervals, [
				{ start: first.time, end: accepted.at(-1) ?? later.time }
			]);
			const newPerson = {
				name: 'Kiosk New Person',
				company_id: COMPANY_ID,
				employee_number: 'KIOSK-TEST'
			};
			const created = await invoke('kiosk_enroll', {
				new_person: newPerson,
				face_embedding: embedding,
				consent_at: '2026-01-01T00:00:00Z'
			});
			assert.equal(
				asRecord(created.value, 'new person').status,
				'PENDING',
				JSON.stringify(created.value)
			);
			const beforeDuplicate = await session.query('select id from employees order by id');
			const duplicate = await invoke('kiosk_enroll', {
				new_person: { ...newPerson, name: 'Duplicate Employment' },
				face_embedding: embedding,
				consent_at: '2026-01-01T00:00:00Z'
			});
			assert.ok(duplicate.status >= 400, JSON.stringify(duplicate.value));
			assert.deepEqual(
				await session.query('select id from employees order by id'),
				beforeDuplicate,
				'failed employment must not leave an orphan person'
			);
		} finally {
			await session.stop();
		}
	}
);
