import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProfiles } from './e2e/profiles/TH.ts';
import { computePayslip } from './e2e/oracle/TH.ts';

const scenarios = generateProfiles();
for (const id of [
	'refuse-hazardous-8h-normal-day',
	'refuse-hazardous-ot',
	'refuse-pregnant-ot',
	'refuse-minor-ot',
	'refuse-minor-holiday',
	'minor-turns-18-after-period'
])
	test(`TH oracle: ${id} warns and still settles recorded work`, () => {
		const scenario = scenarios.find((row) => row.id === `th-${id}`);
		assert.ok(scenario);
		const result = computePayslip(scenario);
		assert.equal(result.refused, null);
		assert.ok(result.warnings.length > 0);
		assert.ok((result.lines.gross?.amount ?? 0) > 0);
		assert.equal(
			result.lines.net?.amount,
			Math.round(
				((result.lines.gross?.amount ?? 0) - (result.lines.total_deductions?.amount ?? 0)) * 100
			) / 100
		);
	});

for (const scenario of scenarios.filter((row) => row.id.endsWith('-120d')))
	test(`TH fixture: ${scenario.id} encashes only the recorded opening leave before one-year eligibility`, () => {
		assert.equal(scenario.exit?.annualLeaveTakenThisYear, 0);
		const result = computePayslip(scenario);
		assert.equal(result.lines.LEAVE_ENCASHMENT?.base, scenario.exit?.carriedLeaveDays);
	});
