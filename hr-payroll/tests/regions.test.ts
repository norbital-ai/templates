/** An entity's region picker offers the regions its version's rules name. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { regionsIn } from '../src/lib/ui/entity/regions.ts';

test('by_region tables and holiday region limits name the regions, once each', () => {
	assert.deepEqual(
		regionsIn([
			{ minimum_wage: { by_region: { NCR: 695, CAR: 470 }, by_employment_type: { DOMESTIC: 1 } } },
			{ holidays: [{ date: '2026-01-02', regions: ['NCR', 'R3'] }, { date: '2026-01-01' }] }
		]),
		['CAR', 'NCR', 'R3']
	);
	assert.deepEqual(regionsIn([{ rate: 0.1 }]), []);
});
