import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProfiles } from './e2e/profiles/TW.ts';
import { computePayslip } from './e2e/oracle/TW.ts';

for (const [priorDays, deduction] of [
	[3, 600],
	[4, 1200]
] as const)
	test(`TW oracle: ${priorDays} earlier menstrual days plus 29 sick days leave a ${deduction} monthly deduction`, () => {
		const baseline = generateProfiles().find(
			(row) => row.id === 'tw-menstrual-1-after-4-sick-3-26'
		);
		assert.ok(baseline);
		const result = computePayslip({
			...baseline,
			leave: { ...baseline.leave, menstrualPriorDays: priorDays }
		});
		assert.equal(result.lines.MENSTRUAL_LEAVE?.amount, deduction);
	});
