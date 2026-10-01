import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProfiles } from './e2e/profiles/JP.ts';
import { computePayslip } from './e2e/oracle/JP.ts';

test('Japan — managers retain night premiums beyond the normal day and at both night boundaries', () => {
	const scenarios = generateProfiles();
	for (const [id, amount] of [
		['jp-ot-manager-night', 500],
		['jp-ot-manager-rest-night', 8],
		['jp-ot-manager-night-end', 8]
	] as const) {
		const scenario = scenarios.find((row) => row.id === id);
		assert.ok(scenario, id);
		const slip = computePayslip(scenario);
		assert.equal(slip.refused, null, id);
		assert.equal(slip.lines.OVERTIME?.amount ?? 0, 0, id);
		assert.equal(slip.lines.NIGHT_PREMIUM?.amount, amount, id);
	}
});
