// Two ways a law row is reached from outside the month's own chain: an ad hoc entry that posts to a statutory account
// (a tax instalment the authority directs) counts as that scheme's amount withheld without entering the base the scheme
// is worked out from; and terms signed after their first month's pay date pays those days as back pay of the period
// it was signed in, on the row the law names in `conversions.back_pay`. Malaysia's law pack is the fixture; each figure
// is the same run without the entry, or the test's own salary and dates.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { ownLines, pay, run, slip } from '../amendment_kit.ts';
import {
	ENTITY,
	ledgerRows,
	pack,
	storedQuery,
	storedReader,
	uuid,
	workspace,
	decimalNumber,
	packTerms
} from '../kit.ts';

const EMPLOYMENT = idOf('employment', uuid(6));
/** No queued work failed and the ledger holds no hard finding. */
const ledgerWhole = (t: Kit) =>
	Effect.gen(function* () {
		assert.deepEqual((yield* t.run_due()).failed, []);
		assert.deepEqual(
			(yield* verify(storedReader(t), t.clock.now().slice(0, 10)))
				.filter((finding) => finding.invariant !== 'W1')
				.map((finding) => `${finding.invariant} ${finding.message}`),
			[]
		);
	});
const malaysia = (amount: number) => pack('MY', 'Asia/Kuala_Lumpur', packTerms(amount), {}, [], []);

describe('a tax instalment posted to the tax scheme’s account', () => {
	const seed = malaysia(8227);
	const INSTALMENT = 1115;
	const directed = (t: Kit) =>
		t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: EMPLOYMENT,
							catalog_code: 'CP38_INSTALMENT',
							description: 'Directed instalment',
							quantity: String(INSTALMENT),
							unit: 'MONEY',
							incurred_on: '2026-02-01'
						}
					]
				})
			)
		);

	it.live(
		'is deducted and counted as tax withheld, and kept out of the tax the next months are worked out from',
		() =>
			Effect.gen(function* () {
				const plain = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* pay(t, '2026-02');
					yield* pay(t, '2026-03');
					return [yield* ownLines(t, '2026-02'), yield* ownLines(t, '2026-03')];
				}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })));
				const t = yield* TestWorkspace;
				yield* directed(t);
				yield* pay(t, '2026-02');
				const february = yield* ownLines(t, '2026-02');
				assert.equal(february['CP38_INSTALMENT/EMPLOYEE'], -INSTALMENT);
				assert.equal(
					february['PCB/EMPLOYEE'],
					plain[0]?.['PCB/EMPLOYEE'],
					'the tax is worked out as without it'
				);
				const { payslip } = yield* storedQuery(t, {
					payslip: { where: { period: { eq: '2026-02' } }, limit: 1 }
				});
				assert.equal(
					decimalNumber(payslip.rows[0]?.tax_withheld),
					-(february['PCB/EMPLOYEE'] ?? 0) + INSTALMENT,
					'tax withheld is the scheme’s amount and the instalment'
				);
				// the next month's tax reads the year's tax without the instalment
				yield* pay(t, '2026-03');
				assert.equal((yield* ownLines(t, '2026-03'))['PCB/EMPLOYEE'], plain[1]?.['PCB/EMPLOYEE']);
				const posted = (yield* ledgerRows(t)).filter(
					(row) => row.account === 'statutory' && row.code === 'CP38.employee'
				);
				assert.deepEqual(
					posted.map((row) => [row.measure, decimalNumber(row.amount)]),
					[['paid', INSTALMENT]]
				);
				yield* ledgerWhole(t);
				assert.ok((yield* slip(t, '2026-02')).net > 0);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('a joiner signed after the month’s pay date', () => {
	// joined on 23 February and signed on 26 February, the day after February's pay date
	const SALARY = 4000;
	const base = malaysia(SALARY);
	const seed = {
		...base,
		employment: (base.employment ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-02-23', to: null },
			service_started_on: '2026-02-23'
		})),
		contract_terms: (base.contract_terms ?? []).map((row) => ({
			...row,
			effective_from: '2026-02-23',
			signed_on: '2026-02-26'
		})),
		statutory_parameters: (base.statutory_parameters ?? []).map((row) => ({
			...row,
			effective_from: '2026-02-23'
		}))
	};

	it.live('is paid the first days as back pay of the next month, on the law’s back-pay row', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const february = yield* pay(t, '2026-02');
			const { payslip } = yield* storedQuery(t, {
				payslip: { where: { payroll_run_id: { eq: february.id } }, limit: 1 }
			});
			assert.deepEqual(payslip.rows, [], 'nothing was signed by February’s pay date');
			yield* run(t, '2026-03');
			const march = yield* ownLines(t, '2026-03');
			assert.equal(march['BASIC/EMPLOYEE'], SALARY);
			// 6 of February's 28 calendar days
			assert.equal(march['BPAYBS/EMPLOYEE'], Math.round(((SALARY * 6) / 28) * 100) / 100);
			yield* ledgerWhole(t);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
});
