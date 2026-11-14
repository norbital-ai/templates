// A run effect fires after the run's payslips are written, so it reads what they withheld: a run that withholds a scheme
// raises its remittance task, one that withholds nothing raises none. The fixture law's monthly contribution effect is
// varied to read the run's payslips; no figure of that law is under test.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { ENTITY, lawWith, pack, storedQuery, workspace, packTerms } from '../kit.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const EFFECT = 'EPF_MONTHLY_CONTRIBUTION';
/** The remittance effect raises its task only when a payslip of the run withholds the scheme. */
const base = lawWith(pack('MY', 'Asia/Kuala_Lumpur', packTerms(5000), {}, [], []), {
	registered_effect: {
		[EFFECT]: {
			reads: {
				payslip: {
					where: { payroll_run_id: { eq: { var: 'ctx.entry.id' } } },
					fields: ['breakdown'],
					limit: 10000
				}
			},
			condition: `return ctx.reads.payslip.some((slip) => get(slip.breakdown, 'statutory', []).some((row) => row.code === 'EPF' && (row.employee > 0 || row.employer > 0)));`
		}
	}
});
const seedOf = (engagement: string) => ({
	...base,
	contract_terms: (base.contract_terms ?? []).map((row) => ({ ...row, engagement }))
});
const remittances = (engagement: string) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [{ entity_id: ENTITY, period: '2026-11', kind: 'ON_CYCLE' }]
		});
		const due = yield* t.run_due();
		assert.deepEqual(due.failed, []);
		const { obligation } = yield* storedQuery(t, { obligation: { limit: 1000 } });
		return obligation.rows.filter((row) => row.occurrence_key.includes(`:${EFFECT}:`));
	}).pipe(Effect.provide(workspace({ seed: seedOf(engagement), now: NOW })));

describe('a run effect', () => {
	it.live('reads what the run withheld from its payslips and raises its task', () =>
		Effect.gen(function* () {
			assert.equal((yield* remittances('EMPLOYEE')).length, 1);
		})
	);
	it.live('raises nothing for a run that withheld nothing', () =>
		Effect.gen(function* () {
			assert.deepEqual(yield* remittances('PAYEE'), []);
		})
	);
});
