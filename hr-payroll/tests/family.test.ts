// One fact, one home: the person's family is a list on the contract, and every scheme works its count or flag out of it.
// A child born mid-year opens the leave its birth opens.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { objectValue } from '../src/lib/payroll_engine/reads.ts';
import { accountsIn, catalogRow, measureOf, pack, syncAll, workspace } from './kit.ts';

const father = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 6000, unit: 'MONTHLY' },
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{
		family: [
			{ relation: 'SPOUSE', has_income: true },
			{ relation: 'CHILD', born_on: '2026-07-15' }
		]
	},
	[],
	[],
	'2026-11-15'
);
const married = {
	...father,
	employee_contract: (father.employee_contract ?? []).map((row) => ({
		...row,
		payroll: { date_of_birth: '1990-01-01', gender: 'MALE', marital_status: 'MARRIED' }
	}))
};

describe('the family list', () => {
	it.live('a child born mid-year opens the leave of its birth', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			// one child of the one birth: the whole grant its row states
			const id = catalogRow(father, 'leave_catalog', 'PATERNITY_LEAVE');
			const row = (father.leave_catalog ?? []).find((leave) => leave.id === id);
			const grant = Number(objectValue(row?.lookup).grant_days);
			assert.ok(grant > 0);
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'PATERNITY_LEAVE', 'entitled'), grant);
		}).pipe(Effect.provide(workspace({ seed: married, now: '2026-11-20T02:00:00.000Z' })))
	);
});
