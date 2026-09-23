import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock, Effect } from 'effect';
import punch from '../src/functions/+kiosk_punch.ts';

const employmentId = '00000000-0000-4000-8000-0000000000e1';
const companyId = '00000000-0000-4000-8000-0000000000c1';

/** A fixed wall clock: the only reading the handler takes is `currentTimeMillis`. */
const fixedClock = (iso: string): Clock.Clock => {
	const millis = Date.parse(iso);
	return {
		currentTimeMillisUnsafe: () => millis,
		currentTimeMillis: Effect.succeed(millis),
		currentTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
		currentTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
		monotonicTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
		monotonicTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
		sleep: () => Effect.void
	};
};

/** One employment at a company bound to a UTC+7 lineage, and nothing stored for the day yet. */
const bangkokApi = (workDates: string[], created: unknown[]) =>
	({
		db: {
			employments: {
				findFirst: () =>
					Effect.succeed({
						id: employmentId,
						employee_id: 'person',
						company_id: companyId,
						effective_range: { start: '2000-01-01T00:00:00.000Z', end: null }
					})
			},
			companies: {
				findFirst: () => Effect.succeed({ id: companyId, settings_code: 'TH' })
			},
			jurisdiction_settings: {
				findMany: () =>
					Effect.succeed([
						{
							id: 'th-1',
							code: 'TH',
							name: 'Thailand',
							sealed_at: '2025-01-01T00:00:00.000Z',
							voided_at: null,
							approval_id: null,
							effective_range: { start: '2020-01-01T00:00:00.000Z', end: null },
							payroll: { timezone: 'Asia/Bangkok' }
						}
					])
			},
			employees: {
				findFirst: () =>
					Effect.succeed({
						id: 'person',
						face_last_match_at: null,
						face_match_count: 0,
						face_enrollment_status: 'APPROVED'
					})
			},
			work_days: {
				findFirst: (query: { where: { work_date: { eq: string } } }) => {
					workDates.push(query.where.work_date.eq);
					return Effect.succeed(undefined);
				}
			}
		},
		collection: {
			work_days: {
				create: (row: unknown) => {
					created.push(row);
					return Effect.succeed(row);
				}
			}
		}
	}) as unknown as Parameters<typeof punch.handler>[1];

test('a punch at 23:30 in a UTC+7 jurisdiction lands on that local day, not the next one', async () => {
	const workDates: string[] = [];
	const created: unknown[] = [];
	// 16:30 UTC is 23:30 in Bangkok on the 10th, and already 00:30 on the 11th in Kuala Lumpur.
	const execution = punch.handler(
		{ employment_id: employmentId, kind: 'MANUAL' },
		bangkokApi(workDates, created)
	);
	const result = await Effect.runPromise(
		Effect.provideService(execution, Clock.Clock, fixedClock('2026-03-10T16:30:00.000Z'))
	);
	assert.equal(result.status, 'in', JSON.stringify(result));
	assert.deepEqual(workDates, ['2026-03-10T00:00:00.000Z']);
	assert.equal(
		(created[0] as { readonly work_date: string } | undefined)?.work_date,
		'2026-03-10T00:00:00.000Z'
	);
});
