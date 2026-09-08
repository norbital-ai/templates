import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import automation, { runHolidayImport } from '../src/automations/+holiday_import.ts';

const source = {
	jurisdiction_code: 'TEST',
	calendar_id: 'public-holidays',
	time_zone: 'Asia/Singapore',
	enabled: true
};
const event = {
	id: 'festival',
	etag: 'one',
	summary: 'Festival',
	start: { date: '2027-01-01' },
	end: { date: '2027-01-02' }
};

test('the annual job reads every page before one draft write and never publishes', async () => {
	const calls: string[] = [];
	const writes: Record<string, unknown>[] = [];
	const api = {
		progress: () => Effect.void,
		connection: {
			get: (request: { query: { pageToken?: string } }) => {
				calls.push(request.query.pageToken ?? 'first');
				assert.equal(writes.length, 0);
				return Effect.succeed({
					status: 200,
					headers: {},
					body: request.query.pageToken
						? { kind: 'calendar#events', items: [event] }
						: { kind: 'calendar#events', items: [], nextPageToken: 'second' }
				});
			}
		},
		db: {
			jurisdiction_holiday_sources: { findMany: () => Effect.succeed([source]) },
			jurisdiction_holiday_calendars: {
				// Nothing before the write; afterwards the draft the job reads back for its id.
				findMany: () =>
					Effect.succeed(
						writes.map((row) => ({ id: 'draft-1', approval_id: null, published_at: null, ...row }))
					),
				mutate: (rows: Record<string, unknown>[]) =>
					Effect.sync(() => {
						writes.push(...rows);
					})
			}
		}
	} as unknown as Parameters<typeof runHolidayImport>[0];
	const result = await Effect.runPromise(
		runHolidayImport(api, { jurisdiction_code: 'TEST', year: 2027 })
	);
	assert.deepEqual(calls, ['first', 'second']);
	assert.equal(writes.length, 1);
	assert.deepEqual(writes[0]!.observations, []);
	assert.equal(writes[0]!.published_at, undefined);
	assert.equal(result.calendars[0]!.review_required, 1);
	assert.equal(result.calendars[0]!.year, 2027);
	assert.deepEqual(automation.trigger, { schedule: '0 3 1 10 *' });
	assert.equal(automation.spec.connection.authentication.value.env, 'GOOGLE_CALENDAR_API_KEY');
});

test('a provider failure leaves existing annual drafts untouched', async () => {
	let writes = 0;
	const api = {
		progress: () => Effect.void,
		connection: { get: () => Effect.succeed({ status: 503, headers: {}, body: 'Unavailable' }) },
		db: {
			jurisdiction_holiday_sources: { findMany: () => Effect.succeed([source]) },
			jurisdiction_holiday_calendars: {
				mutate: () =>
					Effect.sync(() => {
						writes += 1;
					})
			}
		}
	} as unknown as Parameters<typeof runHolidayImport>[0];
	await assert.rejects(Effect.runPromise(runHolidayImport(api, { year: 2027 })), /HTTP 503/);
	assert.equal(writes, 0);
});
