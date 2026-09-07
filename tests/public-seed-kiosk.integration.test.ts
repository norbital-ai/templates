import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
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
			for (const model of ['antispoof', 'blazeface', 'facemesh', 'faceres', 'iris']) {
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
			const punch = (direction: 'in' | 'out') =>
				invoke('kiosk_punch', { employment_id: EMPLOYMENT_ID, kind: 'FACE', direction });
			const first = await punch('in');
			assert.equal(asRecord(first.value, 'arrival').status, 'in', JSON.stringify(first.value));
			const repeated = await punch('in');
			assert.equal(
				asRecord(repeated.value, 'repeat arrival').reason,
				'already-in',
				JSON.stringify(repeated.value)
			);
			const out = await punch('out');
			assert.equal(asRecord(out.value, 'departure').status, 'out', JSON.stringify(out.value));
			const later = await punch('out');
			assert.equal(
				asRecord(later.value, 'later departure').status,
				'out',
				JSON.stringify(later.value)
			);
			const [day] = await session.query(
				'select worked_intervals from work_days where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			assert.deepEqual(day.worked_intervals, [
				{
					start: asRecord(first.value, 'arrival').time,
					end: asRecord(later.value, 'last departure').time
				}
			]);
			const concurrent = await Promise.all(Array.from({ length: 6 }, () => punch('out')));
			for (const result of concurrent)
				assert.ok(result.status < 300, `concurrent departure: ${JSON.stringify(result.value)}`);
			const lastDeparture = concurrent
				.flatMap((result) => {
					const row = asRecord(result.value, 'concurrent departure');
					return typeof row.time === 'string' ? [row.time] : [];
				})
				.sort()
				.at(-1);
			const [concurrentDay] = await session.query(
				'select worked_intervals from work_days where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			assert.deepEqual(concurrentDay.worked_intervals, [
				{ start: asRecord(first.value, 'arrival').time, end: lastDeparture }
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
