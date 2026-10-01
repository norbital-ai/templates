import assert from 'node:assert/strict';
import test from 'node:test';
import { computedEntitlement } from '../src/lib/leave/entitlement.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { inclusiveDays } from '../src/lib/payroll/run/dates.ts';
import { leaveCatalogue } from './fixtures/statutory-world.ts';

for (const annual of leaveCatalogue('TH').filter((row) => row.code === 'ANNUAL_LEAVE'))
	for (const exitDate of ['2026-01-31', '2026-09-30', '2026-12-31'])
		test(`TH ${annual.settings_id} — the six-day annual grant survives exit proration on ${exitDate}`, () => {
			// LPA s.30 grants six days after a year; s.67 prorates only the current-year exit payment.
			// A January grant remains available for lawful leave already taken before September's exit.
			const window = { start: '2026-01-01', end: '2026-12-31' };
			for (const asOf of ['2026-01-01', exitDate]) {
				const result = computedEntitlement({
					rule: annual.entitlement,
					window,
					asOf,
					hireDate: '2021-02-01',
					exitDate,
					servedOn: (date) => date <= exitDate,
					eligibleOn: () => true,
					personOn: (date) =>
						personContext({
							employee: { date_of_birth: '1990-01-01' },
							employment: { service_start: '2021-02-01' },
							terms: null,
							asOf: date
						})
				});
				assert.equal(result.available, 6);
				assert.ok(Math.abs(result.earned! - (6 * inclusiveDays(window.start, asOf)) / 365) < 1e-12);
			}
		});
