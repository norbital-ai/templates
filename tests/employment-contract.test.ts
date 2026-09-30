import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from '@norbital-ai/std/decimal';
import { leaveTermsThrough } from '../src/lib/employment-contract.ts';

// `LeaveEntryActivity` types decimals as numbers; the stored row carries `Decimal`, hence the casts.
const dec = (text: string) => Decimal.of(text) as unknown as number;

// A stored leave row reads its decimals as `Decimal`, whose valueOf throws; a debit adjustment consumes terms on its
// effective day (2026-02-01), a credit consumes none, and an exit before it caps the date.
test('a Decimal leave adjustment decodes before its sign is read', () => {
	const adjustment = { days: dec('-1.5'), effective_on: '2026-02-01', reason: 'Debit' } as const;
	assert.equal(leaveTermsThrough(adjustment, [], null), '2026-02-01');
	assert.equal(leaveTermsThrough(adjustment, [], '2026-01-15'), '2026-01-15');
	assert.equal(leaveTermsThrough({ ...adjustment, days: dec('2') }, [], null), null);
	assert.equal(
		leaveTermsThrough({ hours: dec('-4'), effective_on: '2026-03-02', reason: 'Debit' }, [], null),
		'2026-03-02'
	);
});
