import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import holidays from '../src/collections/jurisdiction_holidays/+collection.ts';
import { transform } from './helpers/transform.ts';

/**
 * The holiday transform's own rules. A holiday carries no consumed stamp: it is frozen while a
 * payroll run's snapshot still points at it, and free again once none does. A work day never
 * points at a holiday — the calendar is overlaid on the date when the day is read — so the
 * transform has no work days to ask about or release. What is asserted here is the field rules,
 * and a row nothing captured.
 */
const holiday = {
	id: 'festival',
	company_id: 'TEST',
	date: '2027-01-01',
	name: 'Festival',
	replaces: null,
	source: null,
	published_at: '2026-12-01T00:00:00.000Z'
};

/** No run captured this holiday. There is no `work_days` table here: the transform must not read it. */
const api = () => ({ payroll_runs: { findMany: () => Effect.succeed([]) } }) as never;

const mutate = (input: Record<string, unknown>, existing?: Record<string, unknown>, db = api()) =>
	transform(holidays, [input], { existing: [existing], db });

test('a holiday needs an entity, a real day and a name', async () => {
	await assert.rejects(() => mutate({ company_id: '', date: '2027-01-01', name: 'x' }), /entity/);
	await assert.rejects(
		() => mutate({ company_id: 'TEST', date: '2027-02-30', name: 'x' }),
		/calendar day/
	);
	await assert.rejects(() => mutate({ company_id: 'TEST', date: '2027-01-01', name: ' ' }), /name/);
	await assert.rejects(
		() => mutate({ company_id: 'TEST', date: '2027-01-01', name: 'x', replaces: 'no' }),
		/replaced date/
	);
	await assert.doesNotReject(() =>
		mutate({ company_id: 'TEST', date: '2027-01-01', name: 'Festival' })
	);
});

test('a holiday nothing points at can change, publish, unpublish and go', async () => {
	for (const change of [
		{ name: 'Renamed' },
		{ date: '2027-02-02' },
		{ company_id: 'OTHER' },
		{ published_at: '2027-01-01T00:00:00.000Z' },
		{ published_at: null }
	])
		await assert.doesNotReject(() => mutate(change, holiday), JSON.stringify(change));
});

test('work days on the date are no reason to hold a holiday still', async () => {
	// The db above has no `work_days` at all: a transform that still asked which days point at the
	// row would throw here rather than pass. Moving and unpublishing are the run's to refuse, and no
	// run captured this one.
	for (const change of [{ date: '2027-01-02' }, { company_id: 'OTHER' }, { published_at: null }])
		await assert.doesNotReject(() => mutate(change, holiday, api()), JSON.stringify(change));
});
