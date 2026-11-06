// An overpaid year flags the HR controller, once. The refund is an entry they make on the Statutory refund item, in Events.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

const effects: readonly { code: string; effects: string }[] = JSON.parse(
	readFileSync('seed/public/jurisdiction/VN/version_7/registered_effect.json', 'utf8')
);
const refund = effects.find((row) => row.code === 'TAX_REFUND');
assert.ok(refund !== undefined);

const raised = (obligation: readonly object[]) =>
	evaluate(
		refund.effects,
		'CALCULATION',
		{
			entry: {
				id: 'slip',
				entity_id: 'entity',
				employee_id: 'person',
				employment_id: 'contract',
				breakdown: {
					statutory: [{ code: 'PIT', kind: 'TAX', employee: 0, employer: 0, overpaid: 500 }]
				}
			},
			reads: { payroll_run: [{ pay_date: '2026-12-25' }], obligation }
		},
		'TAX_REFUND'
	);

describe('tax refund', () => {
	it('raises an obligation, never an entry', () => {
		const [row] = raised([]) as readonly { title: string }[];
		assert.equal(row?.title, 'Tax overpaid in 2026: enter 500 on Statutory refund');
	});
	it('flags a payslip once', () => {
		assert.deepEqual(raised([{ id: 'held' }]), []);
	});
});
