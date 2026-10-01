import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProfiles } from './e2e/profiles/MY.ts';
import { computePayslip, probeLines } from './e2e/oracle/MY.ts';

const scenarios = generateProfiles();
for (const [period, monthDays] of [
	['2026-09', 30],
	['2026-02', 28],
	['2026-08', 31]
] as const)
	for (const wage of [1700, 3100])
		for (const unpaidDays of [1, 5])
			test(`MY oracle adapter: ${unpaidDays} unpaid days from ${wage} in ${period} are a positive saved deduction`, () => {
				const scenario = scenarios.find(
					(row) => row.id === `MY-oracle-unpaid-${period}-${unpaidDays}-${wage}`
				);
				assert.ok(scenario);
				const calculated = computePayslip(scenario);
				const expected = Math.round(((wage * unpaidDays) / monthDays) * 100) / 100;
				assert.equal(calculated.lines.UNPAID_LEAVE?.amount, -expected);
				const saved = probeLines(calculated);
				assert.equal(saved.UNPAID_LEAVE, expected);
				assert.equal(saved.gross, calculated.lines.gross.amount);
				assert.equal(
					saved.net,
					calculated.unresolved.some((row) => row.key === 'net')
						? undefined
						: calculated.lines.net.amount
				);
			});
