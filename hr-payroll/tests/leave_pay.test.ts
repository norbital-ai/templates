/**
 * A leave class prices its own entries: its `pay` lines post on the salary slip in the slip's leave context, as the
 * work lines did. The kit's UNPAID class carries the NO_PAY_LEAVE deduction (`jurisdiction_kit.ts`).
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { CATALOG, COMPANY, employer, employment, runOf, world } from './jurisdiction_kit.ts';

const MARCH = { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' } as const;

/** Two unpaid working days in March (of 22), under the kit, or with the UNPAID class's pay lines cleared. */
const unpaidMarch = (pay: 'kept' | 'cleared') => {
	const rows = employer([{ key: 'a', salary: 3000 }]);
	if (pay === 'cleared')
		rows.set(
			'leave_catalog',
			(rows.get('leave_catalog') ?? []).map((row) =>
				row['id'] === CATALOG.UNPAID ? { ...row, pay: [] } : row
			)
		);
	return world(rows).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			yield* hr.act('leave_catalog_entry.create', [
				{
					catalog_id: CATALOG.UNPAID,
					employment_id: employment('a'),
					occurred_on: PlainDate('2026-03-09'),
					activity: 'TIME_OFF',
					from: PlainDate('2026-03-09'),
					to: PlainDate('2026-03-10')
				}
			]);
			assert.equal((yield* hr.act('payroll_run.create', [MARCH])).kind, 'committed');
			return (yield* runOf(hr, MARCH.period)).slip('a');
		})
	);
};

it.effect(
	'no-pay leave is deducted by its leave class’s pay line, at the amount the work line deducted',
	() =>
		Effect.gen(function* () {
			const slip = yield* unpaidMarch('kept');
			assert.equal(slip.quantities['NO_PAY_LEAVE'], 2);
			assert.equal(slip.lines['NO_PAY_LEAVE'], -272.73);
			assert.equal(slip.gross, 2727.27);
			// the class without the line deducts nothing: no other record prices its days
			const unpriced = yield* unpaidMarch('cleared');
			assert.equal(unpriced.lines['NO_PAY_LEAVE'], undefined);
			assert.equal(unpriced.gross, 3000);
		})
);
