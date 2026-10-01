import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProfiles } from './e2e/profiles/CN-kunming.ts';
import { computePayslip } from './e2e/oracle/CN-kunming.ts';

// MOF/STA2019 No.35 III(2): annual pay rises are multi-month bonuses; non-residents spread over six months.
// Resident60000/12=5000:10% less210 =>5790. Nonresident60000/6=10000:10% less210, times6 =>4740.
for (const [resident, expected] of [
	[true, 5790],
	[false, 4740]
] as const)
	test(`CN oracle: a 60000 annual bonus uses the ${resident ? 'resident twelve' : 'nonresident six'}-month method`, () => {
		const baseline = generateProfiles().find((row) =>
			row.id.includes('bonus-separate-nonresident')
		);
		assert.ok(baseline);
		const result = computePayslip({
			...baseline,
			employee: { ...baseline.employee, taxResident: resident },
			pay: { ...baseline.pay, bonus: { kind: 'ANNUAL_BONUS_SEPARATE', amount: 60000 } }
		});
		assert.equal(result.refused, undefined);
		assert.equal(result.lines['IIT_BONUS.employee'], expected);
	});
