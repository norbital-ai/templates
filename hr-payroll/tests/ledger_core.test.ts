// The ledger's pure core: a source posts the difference from what it has posted, so any repeat posts nothing, and a
// window is one key however late anyone looks at it.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	accountsOf,
	apply,
	diff,
	eventsOf,
	expired,
	leftIn,
	measureOf,
	periodKey,
	periodOf,
	windowOf,
	windowStart,
	type Wanted
} from '../src/lib/ledger/core.ts';

const USED = {
	account: 'leave',
	code: 'ANNUAL_LEAVE',
	period: 'MY.Y.2026-01-01',
	measure: 'used',
	unit: 'DAY',
	effective_on: '2026-03-03'
} as const;
const want = (amount: number): Wanted => ({ ...USED, amount });

describe('diff', () => {
	it('posts what a new source should have posted', () => {
		const rows = diff('leave_catalog_entry:1', [want(2)], []);
		assert.deepEqual(
			rows.map((row) => [row.operation, row.amount, row.source]),
			[['ADD', 2, 'leave_catalog_entry:1']]
		);
	});
	it('posts nothing the second time', () => {
		const first = diff('s', [want(2)], []);
		assert.deepEqual(diff('s', [want(2)], first), []);
	});
	it('posts only the difference after an edit', () => {
		const first = diff('s', [want(2)], []);
		const second = diff('s', [want(3)], first);
		assert.deepEqual(
			second.map((row) => [row.operation, row.amount]),
			[['ADD', 1]]
		);
	});
	it('inverts everything when nothing should stand', () => {
		const first = diff('s', [want(2)], []);
		const edited = diff('s', [want(3)], first);
		const gone = diff('s', [], [...first, ...edited]);
		assert.deepEqual(
			gone.map((row) => [row.operation, row.amount, row.measure]),
			[['DEDUCT', 3, 'used']]
		);
		assert.deepEqual(diff('s', [], [...first, ...edited, ...gone]), []);
	});
	it('takes a wanted amount below zero as a DEDUCT, never a negative amount', () => {
		const rows = diff('s', [want(-2)], []);
		assert.deepEqual(
			rows.map((row) => [row.operation, row.amount]),
			[['DEDUCT', 2]]
		);
	});
	it('adds up what one source wants on one key', () => {
		const rows = diff('s', [want(1), want(1)], []);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.amount, 2);
	});
	it('ignores dust from a sum of floats', () => {
		assert.deepEqual(diff('s', [want(0.1 + 0.2)], diff('s', [want(0.3)], [])), []);
	});
});

describe('apply', () => {
	it('moves the balance by the ledger', () => {
		const rows = diff('s', [want(2)], []);
		assert.deepEqual(apply({}, rows), {
			leave: { ANNUAL_LEAVE: { 'MY.Y.2026-01-01': { used: 2 } } }
		});
	});
	it('leaves the input alone', () => {
		const held = { leave: { ANNUAL_LEAVE: { 'MY.Y.2026-01-01': { used: 1 } } } };
		apply(held, diff('s', [want(2)], []));
		assert.equal(held.leave.ANNUAL_LEAVE['MY.Y.2026-01-01'].used, 1);
	});
	it('removes a key and the empty levels above it', () => {
		const held = apply({}, diff('s', [want(2)], []));
		const gone = apply(held, [{ ...USED, operation: 'REMOVE', amount: 0, source: 'sync' }]);
		assert.deepEqual(gone, {});
	});
	it('reads a stored balance back', () => {
		assert.deepEqual(accountsOf({ pay: { GROSS: { 'MY.Y.2026-01-01': { total: '100' } } } }), {
			pay: { GROSS: { 'MY.Y.2026-01-01': { total: 100 } } }
		});
	});
});

describe('left', () => {
	it('is derived from what is entitled, carried and used', () => {
		assert.equal(leftIn({ entitled: 14, carried: 3, used: 6 }), 11);
	});
	it('works from a limit for claims', () => {
		assert.equal(leftIn({ limit: 576, used: 400 }), 176);
	});
	it('is zero for a window nobody opened', () => {
		assert.equal(leftIn(undefined), 0);
	});
});

describe('windows', () => {
	const started = '2023-03-05';
	it('a year from its start month', () => {
		assert.equal(
			windowStart({ kind: 'YEAR', start_month: 1 }, '2026-06-15', started),
			'2026-01-01'
		);
		assert.equal(
			windowStart({ kind: 'YEAR', start_month: 4 }, '2026-03-31', started),
			'2025-04-01'
		);
		assert.equal(
			windowStart({ kind: 'YEAR', start_month: 4 }, '2026-04-01', started),
			'2026-04-01'
		);
	});
	it('a month', () => {
		assert.equal(windowStart({ kind: 'MONTH' }, '2026-06-15', started), '2026-06-01');
	});
	it('a service year from its anniversary', () => {
		const year = { kind: 'SERVICE_YEAR', offset_months: 0 } as const;
		assert.equal(windowStart(year, '2026-03-04', started), '2025-03-05');
		assert.equal(windowStart(year, '2026-03-05', started), '2026-03-05');
	});
	it('a service year with an offset', () => {
		const year = { kind: 'SERVICE_YEAR', offset_months: 6 } as const;
		assert.equal(windowStart(year, '2023-08-01', started), '2023-09-05');
		assert.equal(windowStart(year, '2024-09-05', started), '2024-09-05');
	});
	it('a block of service', () => {
		const block = { kind: 'BLOCK', months: 24 } as const;
		assert.equal(windowStart(block, '2026-03-04', started), '2025-03-05');
	});
	it('a lifetime and an event', () => {
		assert.equal(windowStart({ kind: 'LIFETIME' }, '2026-06-15', started), started);
		assert.equal(
			windowStart({ kind: 'EVENT', on: '2026-02-02' }, '2026-06-15', started),
			'2026-02-02'
		);
	});
	it('keys carry the scope, so a move starts new accounts', () => {
		const year = { kind: 'YEAR', start_month: 1 } as const;
		assert.equal(periodKey('MY', year, '2026-06-15', started), 'MY.Y.2026-01-01');
		assert.notEqual(
			periodKey('MY', year, '2026-06-15', started),
			periodKey('SG', year, '2026-06-15', started)
		);
	});
	it('a year and its first month are different keys', () => {
		assert.notEqual(
			periodKey('MY', { kind: 'YEAR', start_month: 1 }, '2026-01-15', started),
			periodKey('MY', { kind: 'MONTH' }, '2026-01-15', started)
		);
	});
	it('reads a row’s window from its lookup', () => {
		assert.deepEqual(windowOf({ window: 'SERVICE_YEAR' }), {
			kind: 'SERVICE_YEAR',
			offset_months: 0
		});
		assert.deepEqual(windowOf({ service_offset_months: 6 }), {
			kind: 'SERVICE_YEAR',
			offset_months: 6
		});
		assert.deepEqual(windowOf({ window: 'CALENDAR_YEAR' }), { kind: 'YEAR', start_month: 1 });
		assert.deepEqual(windowOf({ fiscal_year_start_month: 4 }), { kind: 'YEAR', start_month: 4 });
		assert.deepEqual(windowOf({ rolling_months: 24 }), { kind: 'BLOCK', months: 24 });
		assert.deepEqual(windowOf({ window: 'LIFETIME' }), { kind: 'LIFETIME' });
	});
});

describe('eventsOf', () => {
	it('a multiple birth is one birth event', () => {
		assert.deepEqual(
			eventsOf({
				family: [
					{ relation: 'CHILD', born_on: '2026-04-01' },
					{ relation: 'CHILD', born_on: '2026-04-01' },
					{ relation: 'CHILD', born_on: '2026-08-01' },
					{ relation: 'PARENT', born_on: '1960-01-01' }
				]
			}),
			[
				{ kind: 'CHILD_BIRTH', on: '2026-04-01' },
				{ kind: 'CHILD_BIRTH', on: '2026-08-01' }
			]
		);
	});
});

describe('the write boundary', () => {
	it('takes a declared measure and a period of the typed template, and refuses any other, naming it', () => {
		assert.equal(measureOf('used'), 'used');
		assert.equal(periodOf(USED.period), USED.period);
		assert.throws(() => measureOf('usedd'), /usedd: unknown balance measure/);
		assert.throws(() => periodOf('2026'), /2026: malformed balance period/);
		assert.throws(() => periodOf('MY.Q.2026-01-01'), /malformed balance period/);
	});
	it('holds for a figure already on a balance: a key no writer could have made moves nothing', () => {
		const old = 'MY.Y.2001-01-01';
		assert.throws(
			() => expired({ leave: { ANNUAL_LEAVE: { [old]: { taken: 1 } } } }, '2026-11-11', 7),
			/taken: unknown balance measure/
		);
		assert.ok(
			expired({ leave: { ANNUAL_LEAVE: { [old]: { used: 1 } } } }, '2026-11-11', 7).length > 0
		);
	});
});
