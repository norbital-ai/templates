import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	googleHolidayRequest,
	mergeHolidayImport,
	readGoogleHolidayYear,
	reviewHolidayEvent,
	validateHolidaySource
} from '../src/lib/holiday-import.ts';

const source = {
	jurisdiction_code: 'TEST',
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
	assert.equal(result[0]!.revision, 'one');
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

test('imports begin unselected; repeat imports retain reviewed decisions and identities', async () => {
	const incoming = await imported();
	const first = mergeHolidayImport(source, retrievedAt, incoming, null);
	assert.equal(first.events[0]!.review_required, true);
	const reviewed = {
		...first,
		events: first.events.map((row) => ({ ...row, review_required: false }))
	};
	const repeated = mergeHolidayImport(source, '2026-10-02T00:00:00.000Z', incoming, reviewed);
	assert.equal(repeated.events.length, 1);
	assert.equal(repeated.events[0]!.review_required, false);
	assert.equal(repeated.events[0]!.source, first.events[0]!.source);
	const revised = mergeHolidayImport(
		source,
		retrievedAt,
		incoming.map((row) => ({ ...row, revision: 'two' })),
		reviewed
	);
	assert.equal(
		revised.events[0]!.review_required,
		false,
		'upstream metadata alone does not change holiday treatment'
	);
	assert.equal(revised.events[0]!.revision, 'two');
});

test('moved and removed events require review while retaining the previous selection', async () => {
	const incoming = await imported();
	const reviewed = mergeHolidayImport(source, retrievedAt, incoming, null);
	const observation = reviewHolidayEvent([], reviewed.events[0]!, 'OBSERVE', new Set());
	const moved = mergeHolidayImport(
		source,
		retrievedAt,
		incoming.map((row) => ({ ...row, dates: ['2027-01-02'] })),
		{ ...reviewed, events: reviewed.events.map((row) => ({ ...row, review_required: false })) }
	);
	assert.equal(moved.events[0]!.review_required, true);
	assert.equal(observation[0]!.date, '2027-01-01');
	assert.deepEqual(
		reviewHolidayEvent(observation, moved.events[0]!, 'KEEP', new Set()),
		observation
	);
	const removed = mergeHolidayImport(source, retrievedAt, [], reviewed);
	assert.equal(removed.events[0]!.cancelled, true);
	assert.equal(removed.events[0]!.review_required, true);
	assert.deepEqual(removed.events[0]!.dates, ['2027-01-01']);
	assert.throws(
		() => reviewHolidayEvent(observation, removed.events[0]!, 'OBSERVE', new Set()),
		/cancelled/
	);
});

test('sealed holiday and non-holiday dates cannot be renamed, moved, removed or newly observed', async () => {
	const incoming = await imported();
	const reviewed = mergeHolidayImport(source, retrievedAt, incoming, null).events[0]!;
	const observation = reviewHolidayEvent([], reviewed, 'OBSERVE', new Set());
	for (const update of [
		{ ...reviewed, dates: ['2027-01-02'] },
		{ ...reviewed, name: 'Renamed' }
	])
		assert.throws(
			() => reviewHolidayEvent(observation, update, 'OBSERVE', new Set(['2027-01-01'])),
			/sealed/
		);
	assert.throws(
		() => reviewHolidayEvent(observation, reviewed, 'IGNORE', new Set(['2027-01-01'])),
		/sealed/
	);
	assert.throws(
		() => reviewHolidayEvent([], reviewed, 'OBSERVE', new Set(['2027-01-01'])),
		/sealed/
	);
	assert.deepEqual(
		reviewHolidayEvent(observation, reviewed, 'KEEP', new Set(['2027-01-01'])),
		observation
	);
});

test('source review preserves manual holidays and prevents two holidays on the same date', async () => {
	const incoming = await imported();
	const reviewed = mergeHolidayImport(source, retrievedAt, incoming, null).events[0]!;
	const manual = {
		date: '2027-02-01',
		name: 'Announced holiday',
		original_date: null,
		source: 'Official notice'
	};
	const selected = reviewHolidayEvent([manual], reviewed, 'OBSERVE', new Set());
	assert.deepEqual(reviewHolidayEvent(selected, reviewed, 'IGNORE', new Set()), [manual]);
	assert.throws(
		() => reviewHolidayEvent([{ ...manual, date: '2027-01-01' }], reviewed, 'OBSERVE', new Set()),
		/already has/
	);
});
