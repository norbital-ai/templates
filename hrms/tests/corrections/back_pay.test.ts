// A contract version signed after a period was paid changes nothing in that period: what it adds for it is back pay of
// the period it was signed in, on the law's own back-pay row, priced by that period's schemes. A version that was
// signed in time and only keyed late was due all along: its periods are worked out again. The fixture pack names its
// back-pay row in `conversions.back_pay`; every figure is the test's own rates.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { add_days, plain_date } from '../../src/lib/date.ts';
import { Effect } from 'effect';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, dates, ownLines, pay, run } from '../amendment_kit.ts';
import {
	ENTITY,
	WORK,
	catalogRow,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from '../kit.ts';

/** A month's days but its weekends. */
const weekdays = (month: string) =>
	dates(month).filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));

const TERMS = {
	rate: { amount: 7500, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seed = ReturnType<typeof pack>;
const seed = (): Seed =>
	pack(
		'MY',
		'Asia/Kuala_Lumpur',
		TERMS,
		{},
		['2026-02', '2026-03', '2026-04']
			.flatMap(weekdays)
			.map((date) => ({ date, shift: WORK, hours: 8 })),
		[]
	);
/** The law's own back-pay row, as the fixture pack names it, and the contribution read beside it. */
const BACK_PAY = `${String(objectValue(seed().jurisdiction_settings?.[0]?.conversions).back_pay)}/EMPLOYEE`;
const CONTRIBUTION = 'EPF/EMPLOYEE';
/** A new version from `from` at a new rate, made the way HR makes one, with the day it was signed. */
const raised = (t: Kit, amount: number, signed: string, from = '2026-02-01') =>
	Effect.gen(function* () {
		const admin = yield* t.as(t.admin);
		const { employee_contract } = yield* storedQuery(t, {
			employee_contract: { where: { status: { eq: 'SEALED' } }, limit: 10 }
		});
		const held = employee_contract.rows
			.toSorted((a, b) =>
				String(a.effective_range.from).localeCompare(String(b.effective_range.from))
			)
			.at(-1);
		assert.ok(held !== undefined);
		yield* admin.act({
			'employee_contract.create': [
				{
					employee_id: held.employee_id,
					entity_id: held.entity_id,
					engagement: held.engagement,
					employee_number: held.employee_number,
					terms: {
						...held.terms,
						rate: { amount, unit: 'MONTHLY' },
						signed_on: plain_date(signed)
					},
					payroll: held.payroll,
					bank: held.bank,
					employee_extension_data: held.employee_extension_data,
					service_started_on: held.service_started_on,
					effective_range: { from: plain_date(from), to: null },
					status: 'DRAFT',
					reason: 'A raise'
				}
			]
		});
		const drafts = yield* storedQuery(t, {
			employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 1 }
		});
		const [draft] = drafts.employee_contract.rows;
		assert.ok(draft !== undefined);
		if (held.effective_range.to === null)
			yield* admin.act({
				'employee_contract.update': [
					{
						target: held,
						set: {
							effective_range: {
								from: held.effective_range.from,
								to: add_days(plain_date(from), -1)
							}
						}
					}
				]
			});
		yield* admin.act({
			'employee_contract.update': [{ target: draft, set: { status: 'SEALED' } }]
		});
		yield* t.run_due();
		return draft.id;
	});

describe('a raise from a month already paid', () => {
	it.live(
		'signed later: the paid month does not move, and the signing month pays it as back pay',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* raised(t, 9000, '2026-03-10');
				yield* pay(t, '2026-03');
				assert.deepEqual(
					yield* carriedFor(t, '2026-03', '2026-02'),
					{},
					'February is as it was signed'
				);
				const march = yield* ownLines(t, '2026-03');
				assert.equal(march['BASIC/EMPLOYEE'], 9000);
				assert.equal(march[BACK_PAY], 9000 - 7500);
				// the back pay is wages of March: March's contribution is charged on it, beyond a month at the new rate alone
				yield* run(t, '2026-04');
				const april = yield* ownLines(t, '2026-04');
				assert.equal(april[BACK_PAY], undefined);
				assert.ok((march[CONTRIBUTION] ?? 0) < (april[CONTRIBUTION] ?? 0));
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live('signed in time and keyed late: it was due, so the paid month is worked out again', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			yield* raised(t, 9000, '2026-01-20');
			yield* run(t, '2026-03');
			const february = yield* carriedFor(t, '2026-03', '2026-02');
			assert.equal(february['BASIC/EMPLOYEE'], 9000 - 7500);
			// February's contribution is worked out again on its own wages
			assert.ok((february[CONTRIBUTION] ?? 0) < 0);
			const march = yield* ownLines(t, '2026-03');
			assert.equal(march[BACK_PAY], undefined);
		}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live(
		'carried, then voided and replaced by a smaller one: the back pay and its contributions come back',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				const first = yield* raised(t, 9000, '2026-03-10');
				yield* pay(t, '2026-03');
				const [sealed] = (yield* storedQuery(t, {
					employee_contract: { where: { id: { eq: first } }, limit: 1 }
				})).employee_contract.rows;
				assert.ok(sealed !== undefined);
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'employee_contract.update': [
								{ target: sealed, set: { status: 'VOID', reason: 'The wrong figure' } }
							]
						})
					)
				);
				yield* t.run_due();
				yield* raised(t, 8000, '2026-03-10');
				assert.ok(
					(yield* amendments(t)).some(
						(row) => row.period === '2026-03' && row.payroll_run_id === null
					),
					'the signing month is amended'
				);
				yield* run(t, '2026-04');
				const march = yield* carriedFor(t, '2026-04', '2026-03');
				assert.equal(march['BASIC/EMPLOYEE'], -1000);
				assert.equal(march[BACK_PAY], -1000);
				assert.ok(
					(march[CONTRIBUTION] ?? 0) > 0,
					'the contribution on the back pay taken back returns'
				);
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live(
		'two versions signed late, one after the other: each signing month pays its own back pay',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* raised(t, 8200, '2026-03-10');
				yield* pay(t, '2026-03');
				assert.equal((yield* ownLines(t, '2026-03'))[BACK_PAY], 700);
				yield* raised(t, 9000, '2026-04-10', '2026-03-01');
				yield* run(t, '2026-04');
				const april = yield* ownLines(t, '2026-04');
				assert.equal(april['BASIC/EMPLOYEE'], 9000);
				assert.equal(april[BACK_PAY], 800, 'what the second adds for March');
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-03'), {});
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live(
		'signed between two pay dates and keyed after both: the first is back pay of the second, which was due',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* pay(t, '2026-03');
				yield* raised(t, 9000, '2026-03-10');
				// its facts reach both paid months, so both are worked out again; its terms reach only the one it was
				// signed for
				assert.deepEqual((yield* amendments(t)).map((row) => row.period).toSorted(), [
					'2026-02',
					'2026-03'
				]);
				yield* run(t, '2026-04');
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
				const march = yield* carriedFor(t, '2026-04', '2026-03');
				assert.equal(march['BASIC/EMPLOYEE'], 1500, 'March was due at the new rate');
				assert.equal(march[BACK_PAY], 1500, 'and owed February as back pay');
				const april = yield* ownLines(t, '2026-04');
				assert.equal(april['BASIC/EMPLOYEE'], 9000);
				assert.equal(april[BACK_PAY], undefined);
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live(
		'a record corrected and a raise signed late in one month: each is carried its own way',
		() => {
			const from = seed();
			const CLAIM = 'MEDICAL_CLAIM';
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'claim_catalog_entry.create': [
								{
									entity_id: ENTITY,
									employment_id: idOf('employee_contract', uuid(6)),
									catalog_id: idOf('claim_catalog', catalogRow(from, 'claim_catalog', CLAIM)),
									quantity: '40',
									incurred_on: '2026-02-12'
								}
							]
						})
					)
				);
				yield* t.run_due();
				yield* pay(t, '2026-02');
				const { claim_catalog_entry } = yield* storedQuery(t, {
					claim_catalog_entry: { limit: 10 }
				});
				const [made] = claim_catalog_entry.rows;
				assert.ok(made !== undefined);
				yield* t
					.as(t.admin)
					.pipe(
						Effect.andThen((caller) =>
							caller.act({ 'claim_catalog_entry.delete': [{ target: made }] })
						)
					);
				yield* raised(t, 9000, '2026-03-10');
				yield* run(t, '2026-03');
				// the record: February worked out again without the claim. The raise: back pay of March, not February's
				assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {
					[`${CLAIM}/EMPLOYEE`]: -40
				});
				assert.equal((yield* ownLines(t, '2026-03'))[BACK_PAY], 1500);
			}).pipe(Effect.provide(workspace({ seed: from, now: '2026-03-20T02:00:00.000Z' })));
		}
	);

	it.live(
		'no-pay leave in the month a late raise reaches: the back pay is the new rate less the old, after the leave',
		() => {
			const from = seed();
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'leave_catalog_entry.create': [
								leaveCreate({
									entity_id: ENTITY,
									employment_id: idOf('employee_contract', uuid(6)),
									catalog_id: idOf('leave_catalog', catalogRow(from, 'leave_catalog', 'NPL')),
									days: wholeDays('2026-02-12')
								})
							]
						})
					)
				);
				yield* t.run_due();
				yield* pay(t, '2026-02');
				const taken = -((yield* ownLines(t, '2026-02'))['NPL/EMPLOYEE'] ?? 0);
				assert.ok(taken > 0, 'the day was not paid');
				yield* raised(t, 9000, '2026-03-10');
				yield* run(t, '2026-03');
				assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {});
				// the day off costs (9000 - 7500) / 7500 more at the new rate, so that much less is owed for February
				const owed = (yield* ownLines(t, '2026-03'))[BACK_PAY] ?? 0;
				assert.equal(
					Number((9000 - 7500 - owed).toFixed(2)),
					Number(((taken * (9000 - 7500)) / 7500).toFixed(2))
				);
			}).pipe(Effect.provide(workspace({ seed: from, now: '2026-03-20T02:00:00.000Z' })));
		}
	);

	it.live('a hire signed after its first months: they are back pay of the signing month', () => {
		const packed = seed();
		const from: Seed = {
			...packed,
			employee_contract: (packed.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-02-01', to: null },
				terms: { ...TERMS, signed_on: '2026-04-10' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			yield* pay(t, '2026-03');
			const { payslip } = yield* storedQuery(t, { payslip: { limit: 10 } });
			assert.deepEqual(payslip.rows, [], 'nothing was agreed yet: the months pay nothing');
			yield* run(t, '2026-04');
			const april = yield* ownLines(t, '2026-04');
			assert.equal(april['BASIC/EMPLOYEE'], 7500);
			assert.equal(april[BACK_PAY], 15000);
		}).pipe(Effect.provide(workspace({ seed: from, now: '2026-04-20T02:00:00.000Z' })));
	});
});
