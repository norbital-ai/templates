// PPh 21's last tax period reckons the year's actual gross, premiums included, less the employee's own JHT and JP only.
// The expected figure is PMK 168/2023 worked by hand for twelve Rp10,000,000 months.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';

const catalog = Schema.decodeUnknownSync(Schema.Array(JsonObject))(
	JSON.parse(
		readFileSync(
			'seed/public/jurisdiction/ID/version_3/statutory_contribution_catalog.json',
			'utf8'
		)
	)
);
const pph21 = catalog.find((row) => row.code === 'PPH21');
assert.ok(pph21 !== undefined);
const [settings] = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ lookup: JsonObject })))(
	JSON.parse(
		readFileSync('seed/public/jurisdiction/ID/version_3/jurisdiction_settings.json', 'utf8')
	)
);

describe('PPh 21 in December', () => {
	it('adds the year of premiums and leaves BPJS Kesehatan undeducted', () => {
		// gross 12 x 10,519,000 = 126,228,000; biaya jabatan 6,000,000; JHT and JP 3,600,000; PTKP 54,000,000
		// taxable 62,628,000: 5% of 60,000,000 + 15% of 2,628,000 = 3,394,200, less 11 x 262,975 withheld
		const tax = evaluate(
			String(pph21.employee_amount),
			'CALCULATION',
			{
				subject: {
					employment: {
						payroll: { marital_status: 'SINGLE', gender: 'MALE' },
						employee_extension_data: { ptkp_dependents_count: 0 },
						effective_range: { from: '2025-01-01', to: null }
					},
					employer: { entity_id: 'entity' }
				},
				lookup: { ...settings?.lookup, ...(isJsonObject(pph21.lookup) ? pph21.lookup : {}) },
				run: { salary_coverage: { from: '2026-12-01', to: '2026-12-31' } },
				as_of: '2026-12-31',
				subtotals: { ADDITIONAL_WAGES: 10_000_000 },
				statutory: {
					JHT: { employee: 200_000, employer: 370_000 },
					JP: { employee: 100_000, employer: 200_000 },
					JKK: { employee: 0, employer: 89_000 },
					JKM: { employee: 0, employer: 30_000 },
					KESEHATAN: { employee: 100_000, employer: 400_000 }
				},
				balances: {
					ytd: { ADDITIONAL_WAGES: 110_000_000 },
					statutory_contribution: {
						'JHT.employee': 2_200_000,
						'JP.employee': 1_100_000,
						'JKK.employer': 979_000,
						'JKM.employer': 330_000,
						'KESEHATAN.employer': 4_400_000,
						'PPH21.employee': 2_892_725
					}
				}
			},
			'PPH21'
		);
		assert.equal(tax, 501_475);
	});
});
