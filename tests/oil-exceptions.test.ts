// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A worked rest day or public holiday says a decision is owed.
 *
 * OIL is not auto-issued — that is the owner's decision — so the only thing the system owes is the
 * flag. Before it, choosing `PAY` on a worked holiday paid the premium and said nothing, and a
 * credit left on a day that stopped being a worked premium day sat in the ledger unbacked.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { oilExceptions } from '../src/lib/scheduling/oil-exceptions.ts';

const day = (overrides) => ({
	id: 'wd',
	employment_id: 'emp-1',
	work_date: '2026-01-01',
	compensation: 'PAY',
	worked: true,
	premium: true,
	...overrides
});

test('a premium day worked and paid asks whether a lieu day is owed', () => {
	assert.deepEqual(oilExceptions([day({ id: 'wd-1' })]), [
		{
			work_day_id: 'wd-1',
			employment_id: 'emp-1',
			work_date: '2026-01-01',
			action: 'CREATE'
		}
	]);
});

test('a lieu credit on a day nobody worked, or a day that is no longer premium, asks to be removed', () => {
	assert.deepEqual(
		oilExceptions([
			day({ id: 'wd-unworked', compensation: 'LIEU', worked: false }),
			day({ id: 'wd-retracted', compensation: 'LIEU', premium: false, work_date: '2026-01-02' })
		]).map((row) => [row.work_day_id, row.action]),
		[
			['wd-unworked', 'REMOVE'],
			['wd-retracted', 'REMOVE']
		]
	);
});

test('nothing is owed on a settled day', () => {
	assert.deepEqual(
		oilExceptions([
			// A premium day already banked as lieu: the decision was made.
			day({ compensation: 'LIEU' }),
			// An ordinary day, paid — the ordinary case, whether or not it was worked.
			day({ premium: false }),
			day({ premium: false, worked: false }),
			// A premium day nobody worked: no premium earned, so nothing to bank.
			day({ worked: false })
		]),
		[]
	);
});

test('the reading is ordered by date then employment, so two readings of a month agree', () => {
	assert.deepEqual(
		oilExceptions([
			day({ id: 'b', work_date: '2026-02-01', employment_id: 'emp-2' }),
			day({ id: 'a', work_date: '2026-01-01', employment_id: 'emp-9' }),
			day({ id: 'c', work_date: '2026-02-01', employment_id: 'emp-1' })
		]).map((row) => row.work_day_id),
		['a', 'c', 'b']
	);
});
