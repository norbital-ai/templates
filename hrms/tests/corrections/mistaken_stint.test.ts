// A stint that was wholly a mistake and has been paid: its terms rows are deleted. With nothing agreed it pays nothing,
// the paid period waits to be worked out again, and the stint stays for its payslips.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { TERMS, current, refusal, storedQuery, workspace } from '../kit.ts';
import { EMPLOYMENT, amendments, pay, rostered, run } from '../amendment_kit.ts';

describe('a stint keyed by mistake, already paid', () => {
	it.live('loses its terms: the paid month waits, no later run pays it, and the stint stays', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* pay(t, '2026-01');
			// the stint holds a payslip: it cannot be deleted
			yield* refusal(
				admin.act({
					'employment.delete': [{ target: yield* current(t, 'employment', EMPLOYMENT) }]
				})
			);
			yield* admin.act({
				'contract_terms.delete': [
					{ target: yield* current(t, 'contract_terms', idOf('contract_terms', TERMS)) }
				]
			});
			yield* t.run_due();
			assert.deepEqual(
				(yield* amendments(t)).map((row) => row.period),
				['2026-01']
			);
			yield* run(t, '2026-02');
			const { payslip, employment } = yield* storedQuery(t, {
				payslip: { limit: 10 },
				employment: { limit: 10 }
			});
			assert.deepEqual(
				payslip.rows.map((row) => row.period),
				['2026-01']
			);
			assert.equal(employment.rows.length, 1);
		}).pipe(
			Effect.provide(
				workspace({ seed: rostered(['2026-01', '2026-02']), now: '2026-03-02T02:00:00.000Z' })
			)
		)
	);
});
