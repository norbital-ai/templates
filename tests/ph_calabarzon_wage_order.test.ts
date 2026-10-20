import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { evaluateStrict } from '../src/lib/payroll_engine/expressions.js';
import { regionsIn } from '../src/lib/ui/entity/regions.js';
import { readSeedRows } from './seed_values.js';

const rows = readSeedRows(resolve(process.cwd(), 'seed/jurisdiction/PH/version_2'), 'rule_set');
const wageRule = rows.find((row) => row.code === 'minimum_wage');
const contractRule = rows.find((row) => row.code === 'MINIMUM_WAGE_FLOOR_CONTRACT');
assert.ok(wageRule);
assert.ok(contractRule);
const wageRules = Schema.decodeUnknownSync(Schema.Json)(wageRule.rules);
const entries = Schema.Array(Schema.Struct({ from: Schema.String, monthly: Schema.Number }));
const wages = Schema.decodeUnknownSync(
	Schema.Struct({
		by_region: Schema.Record(Schema.String, entries),
		by_employment_type: Schema.Record(Schema.String, Schema.Record(Schema.String, entries))
	})
)(wageRules);
const validation = Schema.decodeUnknownSync(Schema.Struct({ when: Schema.String }))(
	contractRule.rules
);
const underFloor = (region: string, day: string, salary: number, domestic = false) =>
	evaluateStrict(validation.when, {
		day,
		rules: { minimum_wage: wageRules },
		company: { region, facts: {} },
		terms: {
			employment_type: domestic ? 'DOMESTIC' : 'PERMANENT',
			base_salary: salary,
			facts: { rate_basis: 'DAILY', hours_per_day: 8 }
		}
	});

describe('CALABARZON wage orders effective 26 October 2026', () => {
	// IVA-23 ss.1–2: https://nwpc.dole.gov.ph/wp-content/uploads/2026/10/Wage-Order-No.-IVA-CALABARZON-23.pdf
	const dailyRates = [
		['IV-A', 600, 645],
		['IV-A-ROSARIO-CAVITE', 600, 645],
		['IV-A-1ST', 550, 590],
		['IV-A-RECLASSIFIED-1ST', 550, 590],
		['IV-A-2ND-5TH', 525, 550],
		['IV-A-AGRI-COMPONENT-1ST', 525, 550],
		['IV-A-AGRI-RECLASSIFIED-1ST', 525, 550],
		['IV-A-AGRI-2ND-5TH', 508, 550],
		['IV-A-RETAIL-SMALL', 508, 550]
	] as const;

	for (const [region, before, after] of dailyRates)
		it(`${region} applies its new daily floor on the order's exact date`, () => {
			assert.equal(underFloor(region, '2026-10-25', before), false);
			assert.equal(underFloor(region, '2026-10-25', before - 0.01), true);
			assert.equal(underFloor(region, '2026-10-26', before), true);
			assert.equal(underFloor(region, '2026-10-26', after - 0.01), true);
			assert.equal(underFloor(region, '2026-10-26', after), false);
			assert.equal(underFloor(region, '2027-01-01', after), false);
			assert.equal(underFloor(region, '2027-01-01', after - 0.01), true);
			const regional = wages.by_region[region];
			assert.ok(regional);
			assert.equal(regional[0]?.from, '2026-10-26');
			assert.equal(regional[0]?.monthly, Math.round((after * 313 * 100) / 12) / 100);
			assert.equal(
				regional.some((entry) => entry.from.startsWith('2027')),
				false
			);
		});

	it('Rosario, Cavite remains separately selectable from other first-class municipalities', () => {
		assert.ok(regionsIn([wageRules]).includes('IV-A-ROSARIO-CAVITE'));
		assert.equal(underFloor('IV-A-1ST', '2026-10-26', 590), false);
		assert.equal(underFloor('IV-A-ROSARIO-CAVITE', '2026-10-26', 590), true);
	});

	it('DW-06 raises every IV-A domestic monthly floor without changing earlier payroll', () => {
		assert.equal(underFloor('IV-A', '2026-10-25', 6750, true), false);
		assert.equal(underFloor('IV-A', '2026-10-26', 6750, true), true);
		assert.equal(underFloor('IV-A', '2026-10-26', 7499.99, true), true);
		assert.equal(underFloor('IV-A', '2026-10-26', 7500, true), false);
		assert.equal(underFloor('IV-A', '2027-01-01', 7500, true), false);
		assert.equal(wages.by_employment_type.DOMESTIC?.['IV-A']?.[0]?.monthly, 7500);
	});
});
