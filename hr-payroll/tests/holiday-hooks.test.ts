import assert from 'node:assert/strict';
import test from 'node:test';
import hooks from '../src/collections/jurisdiction_holidays/+hooks.ts';

const consumed = {
	id: 'festival',
	jurisdiction_code: 'TEST',
	date: '2027-01-01',
	name: 'Festival',
	original_date: null,
	source: null,
	published_at: '2026-12-01T00:00:00.000Z',
	consumed_at: '2027-01-31T00:00:00.000Z'
};
const draft = {
	...consumed,
	id: 'draft',
	date: '2027-02-01',
	published_at: null,
	consumed_at: null
};

const mutate = (input: Record<string, unknown>, existing?: Record<string, unknown>) =>
	hooks.mutate.perRecord.before.handler({ input, existing, api: {} } as never);
const remove = (existing: Record<string, unknown>) =>
	hooks.delete.perRecord.before.handler({ existing, api: {} } as never);

test('a holiday needs a jurisdiction, a real day and a name', () => {
	assert.throws(
		() => mutate({ jurisdiction_code: '', date: '2027-01-01', name: 'x' }),
		/jurisdiction/
	);
	assert.throws(
		() => mutate({ jurisdiction_code: 'TEST', date: '2027-02-30', name: 'x' }),
		/calendar day/
	);
	assert.throws(() => mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: ' ' }), /name/);
	assert.throws(
		() => mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: 'x', original_date: 'no' }),
		/original date/
	);
	assert.doesNotThrow(() =>
		mutate({ jurisdiction_code: 'TEST', date: '2027-01-01', name: 'Festival' })
	);
});

test('an unconsumed holiday can change, publish, unpublish and go', () => {
	for (const change of [
		{ name: 'Renamed' },
		{ date: '2027-02-02' },
		{ published_at: '2027-01-01T00:00:00.000Z' },
		{ published_at: null }
	])
		assert.doesNotThrow(() => mutate(change, draft), JSON.stringify(change));
	assert.doesNotThrow(() => remove(draft));
});

test('a consumed holiday keeps its day, name, jurisdiction and publication, and cannot be deleted', () => {
	for (const change of [
		{ name: 'Renamed' },
		{ date: '2027-01-02' },
		{ jurisdiction_code: 'OTHER' },
		{ original_date: '2026-12-31' },
		{ published_at: null },
		{ consumed_at: null }
	])
		assert.throws(() => mutate(change, consumed), /cannot|consumed/, JSON.stringify(change));
	assert.doesNotThrow(() => mutate({ name: 'Festival', source: 'note' }, consumed));
	assert.throws(() => remove(consumed), /cannot be deleted/);
});
