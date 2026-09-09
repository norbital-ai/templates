import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import hooks from '../src/collections/jurisdiction_holidays/+hooks.ts';

const festival = {
	id: 'festival',
	jurisdiction_code: 'TEST',
	date: '2027-01-01',
	name: 'Festival',
	original_date: null,
	source: null,
	published_at: '2026-12-01T00:00:00.000Z'
};
const draft = {
	...festival,
	id: 'draft',
	date: '2027-02-01',
	published_at: null
};

/** The hook's two reads: capturing runs and pinning work days. */
const api = (runs: readonly unknown[] = [], pins: readonly unknown[] = []) =>
	({
		db: {
			payroll_runs: { findMany: () => Effect.succeed(runs) },
			work_days: {
				findMany: () => Effect.succeed(pins),
				mutate: () => Effect.succeed(undefined)
			}
		}
	}) as never;

const capturedRun = (holidayId: string) => ({
	id: 'run-1',
	period: '2027-01',
	lifecycle: 'DRAFT',
	holidays: [{ id: holidayId }]
});

const mutate = (
	input: Record<string, unknown>,
	existing?: Record<string, unknown>,
	runs: readonly unknown[] = [],
	pins: readonly unknown[] = []
) =>
	Effect.runPromise(
		hooks.mutate.perRecord.before.handler({ input, existing, api: api(runs, pins) } as never)
	);
const remove = (existing: Record<string, unknown>, runs: readonly unknown[] = []) =>
	Effect.runPromise(
		hooks.delete.perRecord.before.handler({ existing, api: api(runs, []) } as never)
	);

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
	await mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: 'Festival' });
});

test('a free holiday can change, publish, unpublish and go', async () => {
	for (const change of [
		{ name: 'Renamed' },
		{ date: '2027-02-02' },
		{ published_at: '2027-01-01T00:00:00.000Z' },
		{ published_at: null }
	])
		await mutate(change, draft);
	await remove(draft);
});

test('a run-captured holiday keeps its day, jurisdiction and publication, and cannot be deleted', async () => {
	const runs = [capturedRun('festival')];
	for (const change of [
		{ date: '2027-01-02' },
		{ jurisdiction_code: 'OTHER' },
		{ published_at: null }
	])
		await assert.rejects(() => mutate(change, festival, runs), /cannot/, JSON.stringify(change));
	// A note is not a retraction: it writes while captured.
	await mutate({ name: 'Festival', source: 'note' }, festival, runs);
	await assert.rejects(() => remove(festival, runs), /cannot be deleted/);
});

test('a pinned holiday is released by re-saving its days, not refused', async () => {
	const pins = [{ id: 'wd-1' }];
	// Unpublishing re-saves the pinning days (re-classifying them) instead of refusing.
	await mutate({ published_at: null }, festival, [], pins);
	// Moving the day the pins point at is refused: add a new holiday instead.
	await assert.rejects(() => mutate({ date: '2027-01-02' }, festival, [], pins), /pinned/);
});
