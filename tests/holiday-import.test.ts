import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	googleHolidayRequest,
	googleHolidayRows,
	readGoogleHolidayYear,
	validateHolidaySource
} from '../src/lib/holiday-import.ts';

const source = {
	company_id: 'TEST',
	calendar_id: 'test#holiday@group.v.calendar.google.com',
	time_zone: 'Asia/Singapore'
};
const retrievedAt = '2026-10-01T00:00:00.000Z';
const event = {
	id: 'festival',
	etag: 'one',
	updated: retrievedAt,
	summary: 'Festival',
	start: { date: '2027-01-01' },
	end: { date: '2027-01-02' }
};

async function imported() {
	return Effect.runPromise(
		readGoogleHolidayYear(source, 2027, () =>
			Effect.succeed({ kind: 'calendar#events', items: [event] })
		)
	);
}

test('annual Google requests use the jurisdiction boundaries and recurrence expansion', () => {
	const request = googleHolidayRequest(source, 2027);
	assert.equal(request.path, `calendars/${encodeURIComponent(source.calendar_id)}/events`);
	assert.equal(request.query.timeMin, '2026-12-31T16:00:00.000Z');
	assert.equal(request.query.timeMax, '2027-12-31T16:00:00.000Z');
	assert.equal(request.query.timeZone, 'Asia/Singapore');
	assert.equal(request.query.singleEvents, 'true');
	assert.equal(request.query.showDeleted, 'true');
	assert.throws(() => validateHolidaySource({ ...source, time_zone: 'Nowhere/Invalid' }), /IANA/);
	assert.throws(() => validateHolidaySource({ ...source, time_zone: '+08:00' }), /IANA/);
	assert.throws(() => googleHolidayRequest(source, 9999), /year/);
});

test('complete paging preserves all-day dates, empty intermediate pages and exclusive ends', async () => {
	const calls: ReturnType<typeof googleHolidayRequest>[] = [];
	const result = await Effect.runPromise(
		readGoogleHolidayYear(source, 2027, (request) => {
			calls.push(request);
			return Effect.succeed(
				calls.length === 1
					? { kind: 'calendar#events', items: [], nextPageToken: 'second' }
					: {
							kind: 'calendar#events',
							items: [{ ...event, start: { date: '2026-12-31' }, end: { date: '2027-01-03' } }]
						}
			);
		})
	);
	assert.equal(calls.length, 2);
	assert.equal(calls[1]!.query.pageToken, 'second');
	assert.deepEqual(result[0]!.dates, ['2027-01-01', '2027-01-02']);
	assert.equal(result[0]!.event_id, 'festival');
	assert.match(result[0]!.source, /\/events\/festival$/);
});

test('failed, repeating, changing and invalid feeds return no completed import', async () => {
	await assert.rejects(
		Effect.runPromise(readGoogleHolidayYear(source, 2027, () => Effect.succeed({}))),
		/kind/
	);
	await assert.rejects(
		Effect.runPromise(
			readGoogleHolidayYear(source, 2027, (request) =>
				request.query.pageToken
					? Effect.fail(new Error('provider unavailable'))
					: Effect.succeed({ kind: 'calendar#events', items: [event], nextPageToken: 'next' })
			)
		),
		/provider unavailable/
	);
	await assert.rejects(
		Effect.runPromise(
			readGoogleHolidayYear(source, 2027, () =>
				Effect.succeed({ kind: 'calendar#events', items: [event], nextPageToken: 'repeat' })
			)
		),
		/repeated/
	);
	await assert.rejects(
		Effect.runPromise(
			readGoogleHolidayYear(source, 2027, (request) =>
				Effect.succeed(
					request.query.pageToken
						? { kind: 'calendar#events', items: [{ ...event, etag: 'two' }] }
						: { kind: 'calendar#events', items: [event], nextPageToken: 'next' }
				)
			)
		),
		/changed an event/
	);
	for (const invalid of [
		{ ...event, start: { dateTime: '2027-01-01T08:00:00Z' } },
		{ ...event, end: { date: '2027-01-01' } },
		{ ...event, end: { date: '2029-01-01' } },
		{ ...event, summary: '' }
	]) {
		await assert.rejects(
			Effect.runPromise(
				readGoogleHolidayYear(source, 2027, () =>
					Effect.succeed({ kind: 'calendar#events', items: [invalid] })
				)
			)
		);
	}
});

test('a Google year proposes one row per live day, and a cancelled event proposes nothing', async () => {
	const events = await Effect.runPromise(
		readGoogleHolidayYear(source, 2027, () =>
			Effect.succeed({
				kind: 'calendar#events',
				items: [
					{ ...event, id: 'two-days', summary: 'Two days', end: { date: '2027-01-03' } },
					{ ...event, id: 'gone', status: 'cancelled' },
					event
				]
			})
		)
	);
	const rows = googleHolidayRows('TEST', events);
	assert.deepEqual(
		rows.map((row) => [row.date, row.name, row.original_date]),
		[
			['2027-01-01', 'Festival', null],
			['2027-01-01', 'Two days', null],
			['2027-01-02', 'Two days', null]
		]
	);
	assert.ok(
		rows.every((row) => row.company_id === 'TEST' && row.source?.includes('/events/'))
	);
});
