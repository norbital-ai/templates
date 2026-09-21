import assert from 'node:assert/strict';
import test from 'node:test';
import { personFactsOn } from '../src/lib/payroll/facts.ts';

const fields = [
	{
		key: 'table_dependants',
		type: 'number' as const,
		change_effect: 'NEXT_YEAR_JANUARY' as const
	},
	{ key: 'table_declaration_reference', type: 'string' as const }
];

const schemes = [{ id: 's1', code: 'INCOME_TAX', elections: fields }];

const declaration = (start: string, end: string | null, dependants: number, reference: string) => ({
	employment_id: 'e1',
	statutory_contribution_id: 's1',
	status: {
		kind: 'REGISTERED' as const,
		reference_number: 'R',
		rate_override: null,
		elections: { table_dependants: dependants, table_declaration_reference: reference }
	},
	effective_range: { start, end }
});

const rows = [
	declaration('2025-01-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z', 3, 'D-3'),
	declaration('2026-06-01T00:00:00.000Z', '2027-02-28T00:00:00.000Z', 1, 'D-1'),
	declaration('2027-03-01T00:00:00.000Z', null, 5, 'D-5')
];

const electionsOn = (asOf: string) =>
	personFactsOn(rows as never, schemes, asOf, 'e1').find((row) => row.code === 'INCOME_TAX')!
		.elections;

test('a dependant reduction applies the following January, an increase the event month', () => {
	// The reduction is declared 1 June 2026; the prior count holds through 31 December 2026.
	assert.equal(electionsOn('2026-06-15').table_dependants, 3);
	assert.equal(electionsOn('2026-12-31').table_dependants, 3);
	assert.equal(electionsOn('2027-01-01').table_dependants, 1);
	// The increase declared 1 March 2027 applies in that month.
	assert.equal(electionsOn('2027-03-01').table_dependants, 5);
});
