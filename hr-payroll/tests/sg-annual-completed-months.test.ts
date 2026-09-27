import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { isEligible, personContext } from '../src/lib/payroll/run/eligibility.ts';

const catalogues: {
	settings_id: string;
	code: string;
	eligibility: string;
	entitlement: Parameters<typeof computedEntitlement>[0]['rule'];
}[] = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
);

// EA s.88A(2)–(3): completed service months, then nearest whole day (half rounds up).
// These first-year full-time cases have no absence or enhanced contractual entitlement.
// 15 Jan–30 Jun: five months, 7 × 5/12 → 3. 1 Jan–30 Jun: six, 7 × 6/12 → 4.
// This probe does not close the separate no-pay, forfeiture or mid-month release cases.
const annual = catalogues.filter((entry) => entry.code === 'ANNUAL_LEAVE');
assert.ok(annual.length > 0, 'SG annual-leave catalogue rows must be present');
for (const row of annual) {
	for (const [hireDate, expected] of [
		['2026-01-15', 3],
		['2026-01-01', 4]
	] as const) {
		test(`SG annual completed service months: ${row.settings_id}, hired ${hireDate}`, () => {
			const exitDate = '2026-06-30';
			const personOn = (asOf: string) =>
				personContext({
					employee: null,
					employment: { service_start: hireDate, exit_date: exitDate },
					terms: null,
					asOf
				});
			const result = computedEntitlement({
				rule: row.entitlement,
				window: leaveWindowOf(exitDate, row.entitlement),
				asOf: exitDate,
				hireDate,
				exitDate,
				servedOn: (date) => date >= hireDate && date <= exitDate,
				eligibleOn: (date) => isEligible(row.eligibility, personOn(date)),
				personOn
			});
			assert.equal(result.entitlement, expected);
			assert.equal(result.earned, expected);
			assert.equal(result.available, expected);
		});
	}
}
