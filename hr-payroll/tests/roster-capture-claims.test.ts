import assert from 'node:assert/strict';
import test from 'node:test';
import { captureClaims, capturedWorkDayFrozen } from '../src/lib/ui/roster/capture-claims.ts';

test('draft pins remain editable; paid, funded and allocated captures freeze independent of run kind', () => {
	const slips = [
		{ id: 'regular-draft' },
		{ id: 'correction-paid', paid_at: '2026-01-01' },
		{ id: 'offcycle-funded', funding_received: 1 },
		{ id: 'fund-date', funding_received_on: '2026-01-01' },
		{ id: 'fund-reference', funding_reference: 'RECEIPT' },
		{ id: 'allocated' }
	];
	const claims = captureClaims(
		slips.map((slip) => ({ id: `day-${slip.id}`, payslip_id: slip.id })),
		slips,
		new Set(['allocated'])
	);
	assert.equal(claims.has('day-regular-draft'), false);
	assert.deepEqual(
		[...claims.keys()],
		slips.slice(1).map((slip) => `day-${slip.id}`)
	);
});

test('person-day renderer stays frozen while capture reads are unresolved, then releases only an unpaid draft', () => {
	const day = { id: 'day', payslip_id: 'draft' };
	assert.equal(capturedWorkDayFrozen(day, [], new Set(), false), true);
	assert.equal(capturedWorkDayFrozen(day, [{ id: 'draft' }], new Set(), true), false);
	assert.equal(capturedWorkDayFrozen(day, [{ id: 'draft' }], new Set(['draft']), true), true);
	assert.equal(
		capturedWorkDayFrozen(day, [{ id: 'draft', paid_at: '2026-01-01' }], new Set(), true),
		true
	);
	assert.equal(capturedWorkDayFrozen({ id: 'new' }, [], new Set(), false), false);
});
