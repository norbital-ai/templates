import assert from 'node:assert/strict';
import test from 'node:test';
import { deductionTotals } from '../src/lib/statutory-deductions.ts';

test('deduction totals separate prior employers and count corrected evidence once', () => {
	const claims = [
		{
			period: '2026-01',
			category: 'LEVY',
			amount: 100,
			source: 'EMPLOYEE',
			reference: 'Trip A',
			event_reference: 'Journey A'
		},
		{
			period: '2026-02',
			category: 'LEVY',
			amount: -30,
			source: 'EMPLOYEE',
			reference: 'Trip A correction',
			event_reference: 'Journey A'
		},
		{
			period: '2026-02',
			category: 'LEVY',
			amount: 150,
			source: 'EMPLOYEE',
			reference: 'Trip B',
			event_reference: 'Journey B'
		},
		{
			period: '2026-02',
			category: 'LEVY',
			amount: -150,
			source: 'EMPLOYEE',
			reference: 'Trip B reversal',
			event_reference: 'Journey B'
		},
		{
			period: '2026-02',
			category: 'LEVY',
			amount: 60,
			source: 'PRIOR_EMPLOYER',
			reference: 'Trip C',
			event_reference: 'Journey C'
		},
		{ period: '2026-03', category: 'LEVY', amount: 300, source: 'EMPLOYEE', reference: 'Future' },
		{ period: '2025-12', category: 'LEVY', amount: 400, source: 'EMPLOYEE', reference: 'Old year' },
		{ period: '2026-01', category: 'OTHER', amount: 80, source: 'EMPLOYEE', reference: 'Trip A' },
		{
			period: '2026-02',
			category: 'LEVY',
			amount: -20,
			source: 'EMPLOYEE',
			reference: 'Trip D correction',
			event_reference: 'Journey D'
		}
	] as const;
	const totals = deductionTotals(claims, '2026-01-01', '2026-02:S1');
	assert.equal(totals.deductions.LEVY, 110);
	assert.equal(totals.deductions_prior_employer.LEVY, 60);
	assert.equal(totals.deduction_claim_counts.LEVY, 2);
	assert.equal(totals.deduction_claim_counts.OTHER, 1);
	assert.equal(totals.deductions_last_year.LEVY, 400);
	assert.equal(totals.deduction_claims_missing_event.LEVY, undefined);
	assert.equal(totals.deduction_claims_missing_event.OTHER, 1);
	assert.equal(totals.deduction_claims_negative_event.LEVY, 1);
});
