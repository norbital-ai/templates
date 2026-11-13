// A dated row of a person that reaches a paid period: the write itself carries that period's amendment row, and under
// an unpaid run it is refused. A term payroll does not read amends nothing, and a parameter changed from a date leaves
// the periods before it alone.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	amendments,
	carriedFor,
	claimAt,
	claimed,
	pay,
	rostered,
	run,
	slip
} from '../amendment_kit.ts';
import { TERMS, current, storedQuery, workspace } from '../kit.ts';

const MONTHS = ['2026-01', '2026-02', '2026-03'] as const;
const DAY = '2026-02-01';
const NOW = '2026-03-20T02:00:00.000Z';
const hr = (t: Kit) => t.as(t.member(['hr_controller']));
/** The stint's terms rows as stored, oldest first. */
const termsRows = (t: Kit) =>
	storedQuery(t, { contract_terms: { limit: 100 } }).pipe(
		Effect.map(({ contract_terms }) =>
			contract_terms.rows.toSorted((a, b) =>
				String(a.effective_from).localeCompare(String(b.effective_from))
			)
		)
	);
/** A raise from 2,800 to 3,000 keyed for `DAY`. */
const raise = (t: Kit) =>
	Effect.flatMap(hr(t), (caller) =>
		caller.act({
			'contract_terms.create': [
				{ employment_id: EMPLOYMENT, effective_from: DAY, rate: { amount: 3000, unit: 'MONTHLY' } }
			]
		})
	);
/** The open amendment rows, by period. */
const open = (t: Kit) =>
	amendments(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.payroll_run_id === null)
				.map((row) => row.period)
				.toSorted()
		)
	);
const failures = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 500 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.map((row) => row.title).filter((title) => /failed/i.test(title))
		)
	);
const provided = Effect.provide(workspace({ seed: rostered(MONTHS), now: NOW }));

describe('a terms row dated in a month a run covers', () => {
	it.live(
		'a paid run: the write carries the month’s amendment row, and the next run its difference',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, MONTHS[0]);
				yield* pay(t, MONTHS[1]);
				yield* raise(t);
				// the row is written as keyed, and its own write left the paid month to be worked out again
				assert.deepEqual(
					(yield* termsRows(t)).map((row) => String(row.effective_from)),
					['2025-01-01', DAY]
				);
				assert.deepEqual(
					(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
					[[MONTHS[1], null]]
				);
				yield* t.run_due();
				assert.deepEqual(yield* failures(t), []);
				const march = yield* run(t, MONTHS[2]);
				assert.equal((yield* carriedFor(t, MONTHS[2], MONTHS[1]))['BASIC/EMPLOYEE'], 200);
				assert.deepEqual(
					(yield* amendments(t)).map((row) => row.payroll_run_id),
					[march.id]
				);
			}).pipe(provided)
	);

	it.live('an unpaid run: the write is refused, and nothing is written', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, MONTHS[0]);
			yield* run(t, MONTHS[1]);
			const refused = yield* Effect.flip(raise(t));
			assert.match(String(refused), /holds this person and is not paid yet/);
			assert.equal((yield* termsRows(t)).length, 1);
			assert.deepEqual(yield* amendments(t), []);
		}).pipe(provided)
	);

	it.live('a term payroll does not read writes no amendment row; a rate on the same row does', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, MONTHS[0]);
			yield* pay(t, MONTHS[1]);
			const caller = yield* hr(t);
			yield* caller.act({
				'contract_terms.create': [
					{ employment_id: EMPLOYMENT, effective_from: DAY, job_title: 'Supervisor' }
				]
			});
			// corrected on the stint's first row, it was always so: every paid month is under it
			yield* caller.act({
				'contract_terms.update': [
					{
						target: yield* current(t, 'contract_terms', idOf('contract_terms', TERMS)),
						set: { job_title: 'Guard' }
					}
				]
			});
			yield* t.run_due();
			assert.deepEqual(yield* amendments(t), []);
			const titled = (yield* termsRows(t)).at(-1);
			assert.ok(titled !== undefined);
			yield* caller.act({
				'contract_terms.update': [
					{ target: titled, set: { rate: { amount: 3000, unit: 'MONTHLY' } } }
				]
			});
			assert.deepEqual(yield* open(t), [MONTHS[1]]);
		}).pipe(provided)
	);
});

describe('a statutory parameter changed from a date', () => {
	it.live(
		'amends the paid months from its date; an earlier one worked out again carries nothing',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, MONTHS[0]);
				yield* pay(t, MONTHS[1]);
				const january = yield* slip(t, MONTHS[0]);
				yield* (yield* hr(t)).act({
					'statutory_parameters.create': [
						{ employment_id: EMPLOYMENT, effective_from: DAY, marital_status: 'MARRIED' }
					]
				});
				assert.deepEqual(yield* open(t), [MONTHS[1]]);
				// January is touched and put back, so the next run works it out again: a claim keyed and deleted
				const extra = yield* claimed(t, 55, '2026-01-13');
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.delete': [{ target: yield* claimAt(t, extra) }]
				});
				yield* t.run_due();
				assert.deepEqual(yield* open(t), [MONTHS[0], MONTHS[1]]);
				yield* run(t, MONTHS[2]);
				// January stood on the parameters in force in January
				assert.deepEqual(yield* carriedFor(t, MONTHS[2], MONTHS[0]), {});
				assert.deepEqual(yield* slip(t, MONTHS[0]), january);
				assert.deepEqual(yield* open(t), []);
			}).pipe(provided)
	);
});
