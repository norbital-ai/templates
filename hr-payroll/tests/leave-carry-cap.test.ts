// @ts-nocheck -- Node executes the workspace source directly with type stripping.
/**
 * MY annual-leave carry (owner rule 2026-10-01): at most 5 unused days carry into the next leave
 * year unless the employee's terms state another number (`annual_leave_carry_max_days`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { approve, id, leaveContext, timeOff } from './helpers/manual-leave-context.ts';

const annual = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/MY/leave_catalogue.json', import.meta.url), 'utf8')
).find((row) => row.code === 'ANNUAL_LEAVE');

/** A 12-day UPFRONT year with the MY row's carry fields; `taken` days used in 2026. */
function carried(taken: number, facts?: Record<string, number>) {
	const context = leaveContext();
	// Hired 2026-01-01: 2026 is the first leave year, so nothing carries into it.
	const hired = { start: '2026-01-01', end: null };
	context.employments[0] = { ...context.employments[0], effective_range: hired };
	context.terms[0] = { ...context.terms[0], effective_range: hired, ...(facts ? { facts } : {}) };
	const { auto_carry_one_year, carry_max_days } = annual.entitlement;
	context.catalogues[0]!.entitlement = {
		...context.catalogues[0]!.entitlement,
		auto_carry_one_year,
		carry_max_days
	};
	if (taken > 0)
		approve(context, timeOff('2026-06-01', `2026-06-${String(taken).padStart(2, '0')}`));
	const [balance] = leaveBalanceSummaries(context, id(1), '2027-01-01');
	return balance!.balance - 12;
}

test('MY annual leave carries at most 5 unused days unless the terms state otherwise', () => {
	assert.equal(annual.entitlement.auto_carry_one_year, true);
	assert.equal(carried(4), 5, '8 unused carry 5');
	assert.equal(carried(4, { annual_leave_carry_max_days: 10 }), 8, 'a 10-day term carries all 8');
	assert.equal(carried(10), 2, '2 unused carry 2');
});
