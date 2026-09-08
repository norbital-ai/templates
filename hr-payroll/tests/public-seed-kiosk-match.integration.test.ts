import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	startPublicSeedHost,
	COMPANY_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS
} from './helpers/public-seed-host.ts';

test(
	'kiosk matching rejects unknown, zero and ambiguous descriptors instead of choosing a person',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-kiosk-match');
		try {
			const headers = bearerHeaders(session.credential);
			const employees = await session.query('select id from employees order by id limit 2');
			assert.equal(employees.length, 2);
			const firstId = String(employees[0]!.id);
			const secondId = String(employees[1]!.id);
			const descriptor = (distance: number, scale = 1) => {
				const vector = Array<number>(1024).fill(0);
				vector[0] = (1 - distance) * scale;
				vector[1] = Math.sqrt(1 - (1 - distance) ** 2) * scale;
				return vector;
			};
			const enroll = (employee_id: string, vector: number[]) =>
				postGuestCommand(
					session.host.baseUrl,
					'invoke.kiosk_enroll',
					{
						input: { employee_id, face_embedding: vector, consent_at: '2026-01-01T00:00:00Z' }
					},
					headers
				);
			const match = () =>
				postGuestCommand(
					session.host.baseUrl,
					'invoke.kiosk_match',
					{ input: { company_id: COMPANY_ID, probe: descriptor(0) } },
					headers
				);
			await enroll(firstId, descriptor(0.1, 15));
			await enroll(secondId, descriptor(0.3));
			const clear = (await match()).value as { status: string; employee?: { id: string } };
			assert.ok(clear.status === 'match' || clear.status === 'unenrolled');
			assert.equal(clear.employee?.id, firstId, 'cosine matching ignores descriptor magnitude');
			await enroll(secondId, descriptor(0.11));
			assert.equal(
				(await match()).value.status,
				'unknown',
				'near ties must not identify the nearest person'
			);
			await enroll(firstId, descriptor(0.24));
			await enroll(secondId, descriptor(0.26));
			assert.equal(
				(await match()).value.status,
				'unknown',
				'the runner-up just outside the acceptance threshold still makes the match ambiguous'
			);
			await enroll(firstId, descriptor(0.3));
			await enroll(secondId, descriptor(0.5));
			assert.equal(
				(await match()).value.status,
				'unknown',
				'weak similarity must not identify anyone'
			);
			await enroll(firstId, descriptor(0));
			await enroll(secondId, descriptor(0));
			assert.equal(
				(await match()).value.status,
				'unknown',
				'duplicate enrollments must not be resolved arbitrarily'
			);
			const zeroProbe = await postGuestCommand(
				session.host.baseUrl,
				'invoke.kiosk_match',
				{ input: { company_id: COMPANY_ID, probe: Array(1024).fill(0) } },
				headers
			);
			assert.ok(zeroProbe.status >= 400, JSON.stringify(zeroProbe.value));
			assert.match(JSON.stringify(zeroProbe.value), /Probe must contain a face descriptor/);
			const beforeInvalidEnrollment = await session.query(
				'select face_embedding from employees where id=$1',
				[firstId]
			);
			const zeroEnrollment = await enroll(firstId, Array(1024).fill(0));
			assert.ok(zeroEnrollment.status >= 400, JSON.stringify(zeroEnrollment.value));
			assert.match(
				JSON.stringify(zeroEnrollment.value),
				/Embedding must contain a face descriptor/
			);
			assert.deepEqual(
				await session.query('select face_embedding from employees where id=$1', [firstId]),
				beforeInvalidEnrollment,
				'a refused zero descriptor must preserve the registered face'
			);
		} finally {
			await session.stop();
		}
	}
);
