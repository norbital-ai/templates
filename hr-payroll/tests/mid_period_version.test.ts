// A contract version that starts inside a period: each day is paid on the version in force on it. The salary of the
// days before the new version is the earlier one's, and overtime worked under the earlier version keeps its hour.
// The Malaysian pack is only the fixture; the expected figures are the salary's share by calendar day and the pack's
// own overtime band, both read from the run itself.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { objectValue } from '../src/lib/payroll_engine/reads.ts';
import { ownLines, run } from './amendment_kit.ts';
import { WORK, pack, uuid, workspace } from './kit.ts';

const terms = (amount: number) => ({
	rate: { amount, unit: 'MONTHLY' },
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});
/** One person paid 3,000 to 15 February and 3,600 from the 16th, with two overtime hours on one day if named. */
const raised = (overtimeOn?: string) => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		terms(3000),
		{},
		// a roster makes every day it leaves out an absence: the salary case keeps none
		overtimeOn === undefined ? [] : [{ date: overtimeOn, shift: WORK, hours: 10, overtime: 2 }],
		[],
		'2026-02-15'
	);
	const [first] = seed.employee_contract ?? [];
	assert.ok(first !== undefined);
	return {
		...seed,
		employee_contract: [
			{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-15' } },
			{
				...first,
				id: uuid(60),
				effective_range: { from: '2026-02-16', to: null },
				terms: { ...objectValue(first.terms), ...terms(3600) }
			}
		]
	};
};
const february = (overtimeOn?: string) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* run(t, '2026-02');
		return yield* ownLines(t, '2026-02');
	}).pipe(Effect.provide(workspace({ seed: raised(overtimeOn), now: '2026-02-20T02:00:00.000Z' })));

describe('a contract version that starts inside the period', () => {
	it.live('pays the days before it at the earlier salary', () =>
		Effect.gen(function* () {
			const lines = yield* february();
			// 15 of February's 28 days at 3,000 and 13 at 3,600
			const basic = (lines['BASIC/EMPLOYEE'] ?? 0) + (lines['PRORATED/EMPLOYEE'] ?? 0);
			assert.equal(
				Math.round(basic * 100) / 100,
				Math.round(((3000 * 15) / 28 + (3600 * 13) / 28) * 100) / 100
			);
		})
	);

	it.live('prices overtime by the version it was worked under', () =>
		Effect.gen(function* () {
			const before = yield* february('2026-02-10');
			const after = yield* february('2026-02-18');
			const early = before['OVERTIME/EMPLOYEE'] ?? 0,
				late = after['OVERTIME/EMPLOYEE'] ?? 0;
			assert.ok(early > 0 && late > 0);
			// the same two hours, at 3,000 and at 3,600
			assert.ok(
				Math.abs(late / early - 3600 / 3000) < 0.01,
				`${String(early)} then ${String(late)}`
			);
		})
	);
});
