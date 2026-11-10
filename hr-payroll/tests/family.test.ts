// One fact, one home: the person's family is a list on the contract, and every scheme works its count or flag out of it.
// Synthetic figures prove the reads: a spouse's income decides Malaysian spouse relief; a child born mid-year opens the
// leave its birth opens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { accountsIn, measureOf, pack, syncAll, workspace } from './kit.ts';

const rows = (file: string) =>
	Schema.decodeUnknownSync(Schema.Array(JsonObject))(
		JSON.parse(readFileSync(`seed/public/jurisdiction/MY/version_5/${file}`, 'utf8'))
	);
const pcb = rows('statutory_contribution_catalog.json').find((row) => row.code === 'PCB');
assert.ok(pcb !== undefined);
const [settings] = rows('jurisdiction_settings.json');
const shared = isJsonObject(settings?.lookup) ? settings.lookup : {};

/** January's PCB on an RM6,000 month for a married citizen with this family. */
const pcbWith = (family: readonly JsonObject[]) =>
	Number(
		evaluate(
			String(pcb.employee_amount),
			'CALCULATION',
			{
				subject: {
					employment: {
						terms: { residency_status: 'CITIZEN' },
						payroll: { marital_status: 'MARRIED' },
						family,
						employee_extension_data: {}
					}
				},
				lookup: {
					...(isJsonObject(shared.constants) ? shared.constants : {}),
					...shared,
					...(isJsonObject(pcb.lookup) ? pcb.lookup : {})
				},
				run: { period: '2026-01' },
				subtotals: { ORDINARY_WAGES: 6000, ADDITIONAL_WAGES: 6000 },
				statutory: {
					EPF: { employee: 660, employer: 780 },
					SOCSO: { employee: 29.75, employer: 104.15 },
					EIS: { employee: 11.9, employer: 11.9 }
				},
				balances: { ytd: {}, statutory_contribution: {} }
			},
			'PCB'
		)
	);

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
	it('a spouse with income takes away the Malaysian spouse relief', () => {
		const alone = pcbWith([]);
		const relieved = pcbWith([{ relation: 'SPOUSE', has_income: false }]);
		assert.ok(relieved < alone);
		assert.equal(pcbWith([{ relation: 'SPOUSE', has_income: true }]), alone);
	});

	it.live('a child born mid-year opens the leave of its birth', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'PATERNITY_LEAVE', 'entitled'), 7);
		}).pipe(Effect.provide(workspace({ seed: married, now: '2026-11-20T02:00:00.000Z' })))
	);
});
