// @ts-nocheck -- Node executes the workspace source directly with type stripping.
/**
 * MY annual-leave carry. EA 1955 s.60E(2) (owner-delegated rule 2026-10-01): each year's unused
 * statutory days carry in full into the next leave year, lapsing at its end. The company's cap
 * (owner rule 2026-10-01: 5 days unless the terms state another number,
 * `annual_leave_carry_max_days`) limits only the company's days above statute:
 * carried = min(unused, statutory) + min(max(unused − statutory, 0), cap).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { approve, id, leaveContext, timeOff } from './helpers/manual-leave-context.ts';

const annual = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/MY/leave_catalogue.json', import.meta.url), 'utf8')
).filter((row) => row.code === 'ANNUAL_LEAVE');

/**
 * A company year of `company` days over a statutory `statutory`, with the MY row's carry rule;
 * `taken` days used in 2026. Hired 2026-01-01, so nothing carries into 2026.
 */
function carried(options: {
	company: number;
	statutory: number;
	taken: number;
	facts?: Record<string, number>;
}) {
	const context = leaveContext();
	const hired = { start: '2026-01-01', end: null };
	context.employments[0] = { ...context.employments[0], effective_range: hired };
	context.terms[0] = {
		...context.terms[0],
		effective_range: hired,
		...(options.facts ? { facts: options.facts } : {})
	};
	const { auto_carry_one_year, carry_max_days } = annual[0].entitlement;
	context.catalogues[0]!.entitlement = {
		...context.catalogues[0]!.entitlement,
		bands: [{ eligibility: '', days: options.company }],
		auto_carry_one_year,
		carry_max_days,
		carry_statutory_bands: [{ eligibility: '', days: options.statutory }]
	};
	approve(context, timeOff('2026-06-01', `2026-06-${String(options.taken).padStart(2, '0')}`));
	const [balance] = leaveBalanceSummaries(context, id(1), '2027-01-01');
	return balance!.balance - options.company;
}

test('MY seed: every annual-leave row carries its statutory ladder in full, capping company days at 5', () => {
	for (const row of annual) {
		assert.equal(row.entitlement.auto_carry_one_year, true);
		assert.deepEqual(row.entitlement.carry_statutory_bands, row.entitlement.bands);
		assert.match(row.entitlement.carry_max_days, /: 5\.0$/);
	}
});

test('MY annual leave: statutory days carry in full, the cap limits only company days', () => {
	// 8 + min(10 − 8, 5) = 10.
	assert.equal(carried({ company: 16, statutory: 8, taken: 6 }), 10);
	// 12 + min(19 − 12, 5) = 17.
	assert.equal(carried({ company: 20, statutory: 12, taken: 1 }), 17);
	// A terms cap of 0: min(6, 8) + 0 = 6.
	assert.equal(
		carried({ company: 8, statutory: 8, taken: 2, facts: { annual_leave_carry_max_days: 0 } }),
		6
	);
	// A terms cap of 10 over 16 company days, 8 statutory, 2 taken: 8 + min(6, 10) = 14.
	assert.equal(
		carried({ company: 16, statutory: 8, taken: 2, facts: { annual_leave_carry_max_days: 10 } }),
		14
	);
});
