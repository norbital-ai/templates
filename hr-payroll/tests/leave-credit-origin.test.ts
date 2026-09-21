import assert from 'node:assert/strict';
import test from 'node:test';
import { creditOriginalDate, type LeaveBalanceEntry } from '../src/lib/leave/balance.ts';

const window = (start: string, end: string) => ({ start, end });
const debit = (creditEntryId: string, start: string, end: string, originalDate?: string) => ({
	window: window(start, end),
	date: start,
	days: -2,
	credit_entry_id: creditEntryId,
	...(originalDate == null ? {} : { original_date: originalDate })
});

const entry = (id: string, extra: Record<string, unknown>): LeaveBalanceEntry =>
	({ id, approval_id: null, allocations: [], ...extra }) as unknown as LeaveBalanceEntry;

test('a transferred credit traces its original salary year through the chain', () => {
	const granted = entry('e1', { to_date: '2025-12-31', allocations: [] });
	const firstCarry = entry('c2', {
		to_date: '2025-12-31',
		destination_from: '2026-01-01',
		destination_to: '2026-12-31',
		allocations: [debit('e1', '2025-01-01', '2025-12-31')]
	});
	const secondCarry = entry('c3', {
		to_date: '2026-12-31',
		destination_from: '2027-01-01',
		destination_to: '2027-12-31',
		allocations: [debit('c2', '2026-01-01', '2026-12-31')]
	});
	const entries = [granted, firstCarry, secondCarry];
	// One hop reads the credit's own date; a second transfer walks back to the grant's year.
	assert.equal(creditOriginalDate(entries, firstCarry), '2025-12-31');
	assert.equal(creditOriginalDate(entries, secondCarry), '2025-12-31');
	// The recorded origin short-circuits the walk.
	const recorded = entry('c4', {
		to_date: '2027-12-31',
		destination_from: '2028-01-01',
		destination_to: '2028-12-31',
		allocations: [debit('c3', '2027-01-01', '2027-12-31', '2025-12-31')]
	});
	assert.equal(creditOriginalDate([...entries, recorded], recorded), '2025-12-31');
});

test('days from two different original years have no single rate and refuse to resolve', () => {
	const first = entry('e1', { to_date: '2025-12-31', allocations: [] });
	const second = entry('e2', { to_date: '2026-12-31', allocations: [] });
	const mixed = entry('c9', {
		to_date: '2026-12-31',
		destination_from: '2027-01-01',
		destination_to: '2027-12-31',
		allocations: [debit('e1', '2025-01-01', '2025-12-31'), debit('e2', '2026-01-01', '2026-12-31')]
	});
	assert.equal(creditOriginalDate([first, second, mixed], mixed), null);
});
