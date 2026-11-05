// An overpaid year comes back as a reversal entry on the adjustment item, once.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

const effects: readonly { code: string; effects: string }[] = JSON.parse(
	readFileSync('seed/public/jurisdiction/VN/version_7/registered_effect.json', 'utf8')
);
const refund = effects.find((row) => row.code === 'TAX_REFUND');
assert.ok(refund !== undefined);

const raised = (earlier: readonly object[]) =>
	evaluate(
		refund.effects,
		'CALCULATION',
		{
			entry: {
				entity_id: 'entity',
				employment_id: 'contract',
				breakdown: {
					statutory: [{ code: 'PIT', kind: 'TAX', employee: 0, employer: 0, overpaid: 500 }]
				}
			},
			reads: {
				adhoc_catalog: [{ id: 'item' }],
				payroll_run: [{ pay_date: '2026-12-25' }],
				adhoc_catalog_entry: earlier
			}
		},
		'TAX_REFUND'
	);

describe('tax refund', () => {
	it('raises a reversal entry for the overpaid amount', () => {
		assert.deepEqual(raised([]), [
			{
				entity_id: 'entity',
				employment_id: 'contract',
				catalog_id: 'item',
				description: 'Tax overpaid in 2026',
				quantity: 500,
				unit: 'MONEY',
				incurred_on: '2026-12-25',
				is_reversal: true
			}
		]);
	});
	it('raises only what this year has not raised', () => {
		const earlier = { catalog_id: 'item', quantity: 500, incurred_on: '2026-12-25' };
		assert.deepEqual(raised([earlier]), []);
	});
});
