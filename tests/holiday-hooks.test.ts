import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import hooks from '../src/collections/jurisdiction_holidays/+hooks.ts';

/**
 * The holiday hook's own rules. A holiday carries no consumed stamp: it is frozen while something
 * still points at it — a payroll run that captured it, or a work day that pins it — and free again
 * once nothing does. `holiday-lieu.test.ts` asserts the capture refusal and the re-save on
 * unpublish; what is asserted here is the rest: the field rules, a row nothing references, the
 * identity a pin holds still, and the release on delete.
 */
const holiday = {
	id: 'festival',
	jurisdiction_code: 'TEST',
	date: '2027-01-01',
	name: 'Festival',
	original_date: null,
	source: null,
	published_at: '2026-12-01T00:00:00.000Z'
};

/** No run captured this holiday; `pins` are the work days that point at it. */
const api = (pins: ReadonlyArray<{ id: string }> = [], released: { id: string }[] = []) =>
	({
		db: {
			payroll_runs: { findMany: () => Effect.succeed([]) },
			work_days: {
				findMany: () => Effect.succeed(pins),
				mutate: (rows: readonly { id: string }[]) => Effect.sync(() => void released.push(...rows))
			}
		}
	}) as never;

const mutate = (input: Record<string, unknown>, existing?: Record<string, unknown>, db = api()) =>
	Effect.runPromise(hooks.mutate.perRecord.before.handler({ input, existing, api: db } as never));
const remove = (existing: Record<string, unknown>, db = api()) =>
	Effect.runPromise(hooks.delete.perRecord.before.handler({ existing, api: db } as never));

test('a holiday needs a jurisdiction, a real day and a name', async () => {
	await assert.rejects(
		() => mutate({ jurisdiction_code: '', date: '2027-01-01', name: 'x' }),
		/jurisdiction/
	);
	await assert.rejects(
		() => mutate({ jurisdiction_code: 'TEST', date: '2027-02-30', name: 'x' }),
		/calendar day/
	);
	await assert.rejects(
		() => mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: ' ' }),
		/name/
	);
	await assert.rejects(
		() => mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: 'x', original_date: 'no' }),
		/original date/
	);
	await assert.doesNotReject(() =>
		mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: 'Festival' })
	);
});

test('a holiday nothing points at can change, publish, unpublish and go', async () => {
	for (const change of [
		{ name: 'Renamed' },
		{ date: '2027-02-02' },
		{ jurisdiction_code: 'OTHER' },
		{ published_at: '2027-01-01T00:00:00.000Z' },
		{ published_at: null }
	])
		await assert.doesNotReject(() => mutate(change, holiday), JSON.stringify(change));
	await assert.doesNotReject(() => remove(holiday));
});

test('a pinned holiday holds the identity the pins point at, and nothing else', async () => {
	const pins = [{ id: 'work-day-1' }, { id: 'work-day-2' }];
	for (const change of [{ date: '2027-01-02' }, { jurisdiction_code: 'OTHER' }])
		await assert.rejects(
			() => mutate(change, holiday, api(pins)),
			/pinned by 2 work day\(s\)/,
			JSON.stringify(change)
		);
	// Everything else about a pinned holiday is still editable: a pin points at a day and a
	// jurisdiction, not at a name, a kind or a note about where the row came from.
	for (const change of [{ name: 'Renamed' }, { original_date: '2026-12-31' }, { source: 'note' }])
		await assert.doesNotReject(() => mutate(change, holiday, api(pins)), JSON.stringify(change));
});

test('deleting a pinned holiday releases its days first', async () => {
	const released: { id: string }[] = [];
	await remove(holiday, api([{ id: 'work-day-1' }], released));
	assert.deepEqual(
		released,
		[{ id: 'work-day-1', holiday_id: null }],
		'each pinning day is released before the row it points at goes'
	);
});
