import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProfiles } from './e2e/profiles/TH.ts';
import { computePayslip } from './e2e/oracle/TH.ts';

const scenarios = generateProfiles();
for (const [carried, taken, expected] of [
	[0, 0, 4487.67],
	[3, 1, 6487.67],
	[0, 6, 0]
])
	test(`TH s.67 — exact September fraction, carry ${carried}, taken ${taken}`, () => {
		const scenario = scenarios.find(
			(row) => row.id === `th-encash-employer_termination-${carried}-${taken}`
		);
		assert.ok(scenario);
		const result = computePayslip(scenario);
		// Six days × 273 / 365, less days already taken, plus agreed carry; daily wage 1000.
		assert.equal(result.lines.LEAVE_ENCASHMENT?.amount ?? 0, expected);
		if (expected > 0) {
			const exact = carried + Math.max(0, (6 * 273) / 365 - taken);
			assert.ok(Math.abs(result.lines.LEAVE_ENCASHMENT!.base! - exact) < 1e-9);
		}
	});
