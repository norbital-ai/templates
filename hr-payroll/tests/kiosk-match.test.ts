import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect, Schema } from 'effect';
import match from '../src/functions/+kiosk_match.ts';
import enroll from '../src/functions/+kiosk_enroll.ts';

const probe = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const companyId = '00000000-0000-4000-8000-000000000001';
const otherCompanyId = '00000000-0000-4000-8000-000000000002';

test('the actual matcher rejects weak and ambiguous neighbours, including a runner-up beyond the cutoff', async () => {
	for (const [distances, expected] of [
		[[], 'unknown'],
		[[0.3], 'unknown'],
		[[NaN], 'unknown'],
		[[0, 0], 'unknown'],
		[[0.1, 0.11], 'unknown'],
		[[0.24, 0.26], 'unknown'],
		[[0.1, 0.2], 'unenrolled'],
		[[0.1], 'unenrolled']
	] as const) {
		let employmentReads = 0;
		const api = {
			db: {
				employees: {
					findNearest: (query: { limit: number; maxDistance: number }) => {
						assert.equal(query.limit, 2);
						assert.equal(query.maxDistance, 0.3);
						return Effect.succeed(
							distances.map((distance, i) => ({ id: String(i), name: 'Fixture', distance }))
						);
					}
				},
				employments: {
					findMany: () => {
						employmentReads++;
						return Effect.succeed([]);
					}
				}
			}
		} as unknown as Parameters<typeof match.handler>[1];
		const execution = match.handler({ company_id: companyId, probe }, api);
		assert.ok(Effect.isEffect(execution));
		const result = await Effect.runPromise(execution);
		assert.equal(result.status, expected, JSON.stringify(distances));
		assert.equal(employmentReads, expected === 'unknown' ? 0 : 1);
	}
});

test('zero vectors cannot be matched or enrolled', async () => {
	const zero = Array<number>(1024).fill(0);
	const api = {} as Parameters<typeof match.handler>[1];
	const matching = match.handler({ company_id: companyId, probe: zero }, api);
	assert.ok(Effect.isEffect(matching));
	await assert.rejects(Effect.runPromise(matching), /face descriptor/);
	const enrolling = enroll.handler(
		{ face_embedding: zero, consent_at: '2020-01-01T00:00:00Z' },
		api
	);
	assert.ok(Effect.isEffect(enrolling));
	await assert.rejects(Effect.runPromise(enrolling), /face descriptor/);
});

test('matching requires an explicit entity before a face probe can be submitted', () => {
	assert.throws(() => Schema.decodeUnknownSync(match.schema)({ probe }), /company_id/);
});

const activeContract = (
	id: string,
	company_id = companyId,
	employment_departure: readonly { exit_date: string; exit_reason: string }[] = []
) => ({
	id,
	employee_id: 'person',
	company_id,
	employee_number: id,
	hire_date: '2000-01-01',
	effective_range: { start: '2000-01-01T00:00:00.000Z', end: null },
	employment_departure
});

const matchingApi = (
	contracts: readonly ReturnType<typeof activeContract>[],
	expectedCompanyId = companyId
) =>
	({
		db: {
			employees: {
				findNearest: () => Effect.succeed([{ id: 'person', name: 'Fixture person', distance: 0.1 }])
			},
			employments: {
				findMany: (query: { where: { company_id: { eq: string } } }) => {
					assert.equal(query.where.company_id.eq, expectedCompanyId);
					return Effect.succeed(contracts);
				}
			}
		}
	}) as unknown as Parameters<typeof match.handler>[1];

test('one profile active in two entities matches only the explicitly selected contract', async () => {
	const contracts = [activeContract('other', otherCompanyId), activeContract('selected')];
	const result = await Effect.runPromise(
		match.handler({ company_id: companyId, probe }, matchingApi(contracts))
	);
	assert.equal(result.status, 'match');
	if (result.status === 'match') assert.equal(result.employment.id, 'selected');
	const other = await Effect.runPromise(
		match.handler({ company_id: otherCompanyId, probe }, matchingApi(contracts, otherCompanyId))
	);
	assert.equal(other.status, 'match');
	if (other.status === 'match') assert.equal(other.employment.id, 'other');
});

test('another entity contract never substitutes for an ended selected contract', async () => {
	const ended = {
		...activeContract('departed'),
		employment_departure: [{ exit_date: '2001-01-01', exit_reason: 'RESIGNATION' }]
	};
	const contracts = [activeContract('other', otherCompanyId), ended];
	const result = await Effect.runPromise(
		match.handler({ company_id: companyId, probe }, matchingApi(contracts))
	);
	assert.equal(result.status, 'unenrolled');
});

test('overlapping active contracts within one entity refuse rather than taking the first row', async () => {
	await assert.rejects(
		Effect.runPromise(
			match.handler(
				{ company_id: companyId, probe },
				matchingApi([activeContract('first'), activeContract('second')])
			)
		),
		/overlapping active/
	);
});
