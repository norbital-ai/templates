// A change of terms signed after a period was paid changes nothing in that period: what it adds for it is back pay of
// the period it was signed in, carried line by line on each item's own catalogue and subtotal (`back_pay_period`) rather
// than collapsed onto a synthetic ad hoc arrears row. One that was signed in time and only keyed late was due all along:
// its periods are worked out again. A late-signed row corrected after its signing month is paid (edited, moved or
// deleted) amends that month, and the back pay and its contributions follow.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf, objectValue } from '../../src/lib/reads.ts';
import {
	amendments,
	backPayFor,
	carriedBackPayFor,
	carriedFor,
	carriedOwnFor,
	dates,
	net,
	overtimeKeyed,
	ownLines,
	paidInAll,
	pay,
	rostered,
	run,
	slip
} from '../amendment_kit.ts';
import {
	EMPLOYMENT,
	ENTITY,
	PAY_GROUP,
	WORK,
	agreedTerms,
	endStint,
	stintOf,
	current,
	leaveCreate,
	ledgerWhole,
	pack,
	stintOver,
	wholeDays,
	workspace,
	storedQuery,
	packTerms
} from '../kit.ts';

/** A month's days but its weekends. */
const weekdays = (month: string) =>
	dates(month).filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));

type Seed = ReturnType<typeof pack>;
const seed = (): Seed =>
	pack(
		'MY',
		'Asia/Kuala_Lumpur',
		packTerms(7500),
		{},
		['2026-02', '2026-03', '2026-04']
			.flatMap(weekdays)
			.map((date) => ({ date, shift: WORK, hours: 8 })),
		[]
	);
const CONTRIBUTION = 'EPF/EMPLOYEE';
const STINT = idOf('employment', EMPLOYMENT);
/** A raise from `from`, keyed as HR keys one, with the day it was signed: one terms row. Answers its id. */
const raised = (t: Kit, amount: number, signed: string, from = '2026-02-01') =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'contract_terms.create': [
				{
					employment_id: STINT,
					effective_from: from,
					signed_on: signed,
					rate: { amount, unit: 'MONTHLY' }
				}
			]
		});
		yield* t.run_due();
		const { contract_terms } = yield* storedQuery(t, {
			contract_terms: { where: { effective_from: { eq: from } }, limit: 1 }
		});
		const [made] = contract_terms.rows;
		assert.ok(made !== undefined);
		return made.id;
	});
/** The signing month, paid with the back pay a raise from February signed on 10 March owed; answers the raise. */
const paidLate = (t: Kit) =>
	Effect.gen(function* () {
		yield* pay(t, '2026-02');
		const raise = yield* raised(t, 9000, '2026-03-10');
		yield* pay(t, '2026-03');
		assert.equal((yield* backPayFor(t, '2026-03', '2026-02'))['BASIC/EMPLOYEE'], 9000 - 7500);
		return raise;
	});
/** March is open to be worked out again. */
const marchAmended = (t: Kit) =>
	amendments(t).pipe(
		Effect.map((rows) =>
			assert.ok(
				rows.some((row) => row.period === '2026-03' && row.payroll_run_id === null),
				'the signing month is amended'
			)
		)
	);

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
				assert.equal(march['BPAYBS/EMPLOYEE'], undefined, 'no synthetic ad hoc arrears line');
				assert.deepEqual(yield* backPayFor(t, '2026-03', '2026-02'), {
					'BASIC/EMPLOYEE': 9000 - 7500
				});
				// the back pay is wages of March: March's contribution is charged on it, beyond a month at the new rate alone
				yield* run(t, '2026-04');
				const april = yield* ownLines(t, '2026-04');
				assert.deepEqual(yield* backPayFor(t, '2026-04'), {});
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
			assert.deepEqual(yield* backPayFor(t, '2026-03'), {});
		}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-03-20T02:00:00.000Z' })))
	);

	it.live(
		'carried, then edited to a smaller one: the back pay and its contributions come back',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const raise = yield* paidLate(t);
				yield* (yield* t.as(t.admin)).act({
					'contract_terms.update': [
						{
							target: yield* current(t, 'contract_terms', raise),
							set: { rate: { amount: 8000, unit: 'MONTHLY' } }
						}
					]
				});
				yield* t.run_due();
				yield* marchAmended(t);
				yield* run(t, '2026-04');
				const marchOwn = yield* carriedOwnFor(t, '2026-04', '2026-03');
				const marchBack = yield* carriedBackPayFor(t, '2026-04', '2026-03', '2026-02');
				assert.equal(marchOwn['BASIC/EMPLOYEE'], -1000);
				assert.equal(marchBack['BASIC/EMPLOYEE'], -1000);
				assert.ok(
					(marchOwn[CONTRIBUTION] ?? 0) > 0,
					'the contribution on the back pay taken back returns'
				);
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live(
		'carried, then moved to the month it was signed in: nothing is owed for February, and the back pay comes back',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const raise = yield* paidLate(t);
				yield* (yield* t.as(t.admin)).act({
					'contract_terms.update': [
						{
							target: yield* current(t, 'contract_terms', raise),
							set: { effective_from: '2026-03-01' }
						}
					]
				});
				yield* t.run_due();
				yield* marchAmended(t);
				yield* run(t, '2026-04');
				// March was signed by its own pay date: its salary stands, and it no longer answers for February
				const marchOwn = yield* carriedOwnFor(t, '2026-04', '2026-03');
				const marchBack = yield* carriedBackPayFor(t, '2026-04', '2026-03', '2026-02');
				assert.equal(marchOwn['BASIC/EMPLOYEE'], undefined);
				assert.equal(marchBack['BASIC/EMPLOYEE'], -(9000 - 7500));
				assert.ok(
					(marchOwn[CONTRIBUTION] ?? 0) > 0,
					'the contribution on the back pay taken back returns'
				);
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
				assert.equal((yield* ownLines(t, '2026-04'))['BASIC/EMPLOYEE'], 9000);
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live(
		'carried, then deleted: the raise and its back pay come back, with their contributions',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const raise = yield* paidLate(t);
				yield* (yield* t.as(t.admin)).act({
					'contract_terms.delete': [{ target: yield* current(t, 'contract_terms', raise) }]
				});
				yield* t.run_due();
				yield* marchAmended(t);
				yield* run(t, '2026-04');
				const marchOwn = yield* carriedOwnFor(t, '2026-04', '2026-03');
				const marchBack = yield* carriedBackPayFor(t, '2026-04', '2026-03', '2026-02');
				assert.equal(marchOwn['BASIC/EMPLOYEE'], -(9000 - 7500));
				assert.equal(marchBack['BASIC/EMPLOYEE'], -(9000 - 7500));
				assert.ok(
					(marchOwn[CONTRIBUTION] ?? 0) > 0,
					'the contribution on what is taken back returns'
				);
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
				assert.equal((yield* ownLines(t, '2026-04'))['BASIC/EMPLOYEE'], 7500);
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live(
		'two raises signed late, one after the other: each signing month pays its own back pay',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* raised(t, 8200, '2026-03-10');
				yield* pay(t, '2026-03');
				assert.equal((yield* backPayFor(t, '2026-03', '2026-02'))['BASIC/EMPLOYEE'], 700);
				yield* raised(t, 9000, '2026-04-10', '2026-03-01');
				yield* run(t, '2026-04');
				const april = yield* ownLines(t, '2026-04');
				assert.equal(april['BASIC/EMPLOYEE'], 9000);
				assert.equal(
					(yield* backPayFor(t, '2026-04', '2026-03'))['BASIC/EMPLOYEE'],
					800,
					'what the second adds for March'
				);
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
				// the row reaches both paid months, so both are worked out again; its terms apply only to the one it was
				// signed for
				assert.deepEqual((yield* amendments(t)).map((row) => row.period).toSorted(), [
					'2026-02',
					'2026-03'
				]);
				yield* run(t, '2026-04');
				assert.deepEqual(yield* carriedFor(t, '2026-04', '2026-02'), {});
				const marchOwn = yield* carriedOwnFor(t, '2026-04', '2026-03');
				const marchBack = yield* carriedBackPayFor(t, '2026-04', '2026-03', '2026-02');
				assert.equal(marchOwn['BASIC/EMPLOYEE'], 1500, 'March was due at the new rate');
				assert.equal(marchBack['BASIC/EMPLOYEE'], 1500, 'and owed February as back pay');
				const april = yield* ownLines(t, '2026-04');
				assert.equal(april['BASIC/EMPLOYEE'], 9000);
				assert.deepEqual(yield* backPayFor(t, '2026-04'), {});
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
									employment_id: STINT,
									catalog_code: CLAIM,
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
				assert.deepEqual(yield* backPayFor(t, '2026-03', '2026-02'), {
					'BASIC/EMPLOYEE': 1500
				});
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
									employment_id: STINT,
									catalog_code: 'NPL',
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
				// both BASIC and NPL keep their own catalogue lines: BASIC +1500 and NPL -(1500/7500 of the day)
				const back = yield* backPayFor(t, '2026-03', '2026-02');
				assert.equal(back['BASIC/EMPLOYEE'], 9000 - 7500);
				assert.equal(
					Number((-(back['NPL/EMPLOYEE'] ?? 0)).toFixed(2)),
					Number(((taken * (9000 - 7500)) / 7500).toFixed(2))
				);
			}).pipe(Effect.provide(workspace({ seed: from, now: '2026-03-20T02:00:00.000Z' })));
		}
	);

	it.live(
		'a first day moved back into a month the group has paid, where the person had no payslip: the month is worked out and carried',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				const { payslip } = yield* storedQuery(t, { payslip: { limit: 10 } });
				assert.deepEqual(payslip.rows, [], 'the stint had not begun: February paid nothing');
				yield* (yield* t.as(t.admin)).act({
					'employment.update': [
						{
							target: yield* current(t, 'employment', STINT),
							set: { effective_range: { from: '2026-02-01', to: null } }
						}
					]
				});
				yield* t.run_due();
				assert.deepEqual(
					(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
					[['2026-02', null]]
				);
				yield* run(t, '2026-03');
				assert.equal((yield* ownLines(t, '2026-03'))['BASIC/EMPLOYEE'], 7500);
				assert.equal((yield* carriedFor(t, '2026-03', '2026-02'))['BASIC/EMPLOYEE'], 7500);
			}).pipe(
				Effect.provide(
					workspace({ seed: stintOver(seed(), '2026-03-01'), now: '2026-03-20T02:00:00.000Z' })
				)
			)
	);

	it.live(
		'a stint keyed after its first month was paid without the person: the month is worked out and carried',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* endStint(t, '2026-02-28', 'Resignation');
				yield* t.run_due();
				yield* pay(t, '2026-02');
				yield* pay(t, '2026-03');
				const stint = yield* stintOf(t);
				// back from 1 March, keyed in April
				yield* (yield* t.as(t.admin)).act({
					'employment.create': [
						{
							employee_id: stint.employee_id,
							entity_id: stint.entity_id,
							employee_number: stint.employee_number,
							effective_range: { from: '2026-03-01', to: null },
							reason: 'Rehired the next day',
							terms: [
								{
									effective_from: '2026-03-01',
									engagement: 'EMPLOYEE',
									pay_group_id: idOf('pay_group', PAY_GROUP),
									...agreedTerms(7500)
								}
							],
							parameters: [
								{
									effective_from: '2026-03-01',
									parameters: { residency_status: 'CITIZEN', marital_status: 'SINGLE' }
								}
							]
						}
					]
				});
				yield* t.run_due();
				assert.ok(
					(yield* amendments(t)).some(
						(row) => row.period === '2026-03' && row.payroll_run_id === null
					),
					'March waits to be worked out'
				);
				yield* run(t, '2026-04');
				assert.equal((yield* carriedFor(t, '2026-04', '2026-03'))['BASIC/EMPLOYEE'], 7500);
			}).pipe(Effect.provide(workspace({ seed: seed(), now: '2026-04-20T02:00:00.000Z' })))
	);

	it.live('a hire signed after its first months: they are back pay of the signing month', () => {
		const packed = seed();
		// the stint and what the law is told start in February; what was agreed is signed in April
		const from: Seed = {
			...packed,
			employment: (packed.employment ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-02-01', to: null }
			})),
			contract_terms: (packed.contract_terms ?? []).map((row) => ({
				...row,
				effective_from: '2026-02-01',
				signed_on: '2026-04-10'
			})),
			statutory_parameters: (packed.statutory_parameters ?? []).map((row) => ({
				...row,
				effective_from: '2026-02-01'
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
			assert.equal((yield* backPayFor(t, '2026-04', '2026-02'))['BASIC/EMPLOYEE'], 7500);
			assert.equal((yield* backPayFor(t, '2026-04', '2026-03'))['BASIC/EMPLOYEE'], 7500);
			assert.equal((yield* backPayFor(t, '2026-04'))['BASIC/EMPLOYEE'], 15000);
		}).pipe(Effect.provide(workspace({ seed: from, now: '2026-04-20T02:00:00.000Z' })));
	});

	it.live(
		'a late-signed raise on a mid-month attendance cutoff loads the reached period’s earlier attendance days',
		() => {
			const base = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				packTerms(7500),
				{},
				['2026-01', '2026-02', '2026-03', '2026-04']
					.flatMap(weekdays)
					.map((date) => ({ date, shift: WORK, hours: 8 })),
				[]
			);
			// attendance opens on the 21st of the prior month: March's run attends 21 Feb–20 Mar
			const cutoff: Seed = {
				...base,
				pay_group: (base.pay_group ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day: 21 }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				yield* pay(t, '2026-03');
				// raise from 1 March, signed 1 April: must load 21–28 Feb attendance so those days stay worked, not absent
				yield* raised(t, 9000, '2026-04-01', '2026-03-01');
				yield* run(t, '2026-04');
				const april = yield* ownLines(t, '2026-04');
				assert.equal(april['BASIC/EMPLOYEE'], 9000);
				assert.deepEqual(yield* backPayFor(t, '2026-04', '2026-03'), {
					'BASIC/EMPLOYEE': 9000 - 7500
				});
				assert.equal(april['ABSENCE/EMPLOYEE'], undefined);
			}).pipe(Effect.provide(workspace({ seed: cutoff, now: '2026-04-20T02:00:00.000Z' })));
		}
	);

	it.live(
		'Malaysia: overtime arrears keep overtime_catalog (ORDINARY_WAGES), stay outside EPF and HRDF, enter SOCSO/EIS, and tax as additional PCB',
		() => {
			// Two identical workers at RM3,000 raised to RM3,600 effective Feb, signed 10 Mar:
			// one worked 10 hours of overtime in February, the other worked none.
			const withOt = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{ ...packTerms(3000, 'MANUAL_LABOUR'), normal_hours_per_week: 45, normal_days_per_week: 6 },
				{},
				['2026-02', '2026-03', '2026-04']
					.flatMap(weekdays)
					.map((date) =>
						date === '2026-02-10' || date === '2026-02-11'
							? { date, shift: WORK, hours: 13, overtime: 5 }
							: { date, shift: WORK, hours: 8 }
					),
				[]
			);
			const withoutOt = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				{ ...packTerms(3000, 'MANUAL_LABOUR'), normal_hours_per_week: 45, normal_days_per_week: 6 },
				{},
				['2026-02', '2026-03', '2026-04']
					.flatMap(weekdays)
					.map((date) => ({ date, shift: WORK, hours: 8 })),
				[]
			);
			const runScenario = (input: Seed) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* pay(t, '2026-02');
					const raise = yield* raised(t, 3600, '2026-03-10');
					yield* pay(t, '2026-03');
					const marchOwn = yield* ownLines(t, '2026-03');
					const marchBack = yield* backPayFor(t, '2026-03', '2026-02');
					const marchSlip = yield* slip(t, '2026-03');
					// Edit the raise after March is paid: April must return basic + OT arrears with exact EPF/HRDF adjustment
					yield* (yield* t.as(t.admin)).act({
						'contract_terms.update': [
							{
								target: yield* current(t, 'contract_terms', raise),
								set: { rate: { amount: 3300, unit: 'MONTHLY' } }
							}
						]
					});
					yield* t.run_due();
					yield* pay(t, '2026-04');
					const aprilCarriedBack = yield* carriedBackPayFor(t, '2026-04', '2026-03', '2026-02');
					const aprilCarriedOwn = yield* carriedOwnFor(t, '2026-04', '2026-03');
					yield* ledgerWhole(t);
					return { marchOwn, marchBack, marchSlip, aprilCarriedBack, aprilCarriedOwn };
				}).pipe(Effect.provide(workspace({ seed: input, now: '2026-04-20T02:00:00.000Z' })));

			return Effect.gen(function* () {
				const ot = yield* runScenario(withOt);
				const plain = yield* runScenario(withoutOt);
				// Back-pay lines keep their own catalogues; zero synthetic BPAYBS
				assert.equal(ot.marchOwn['BPAYBS/EMPLOYEE'], undefined);
				assert.equal(ot.marchBack['BASIC/EMPLOYEE'], 600);
				assert.ok((ot.marchBack['OVERTIME/EMPLOYEE'] ?? 0) > 0, 'OT arrears on OVERTIME catalogue');
				const otLine = ot.marchSlip.breakdown.lines.find(
					(line) => line.code === 'OVERTIME' && line.back_pay_period === '2026-02'
				);
				assert.equal(otLine?.source, 'overtime_catalog');
				assert.equal(otLine?.subtotal, 'ORDINARY_WAGES');
				// EPF Act 1991 s.2 & PSMB Act 612 s.2: OT arrears are exempt from EPF and HRDF
				assert.equal(
					ot.marchOwn['EPF/EMPLOYEE'],
					plain.marchOwn['EPF/EMPLOYEE'],
					'employee EPF excludes OT arrears'
				);
				assert.equal(
					ot.marchOwn['EPF_EMPLOYER/EMPLOYER'],
					plain.marchOwn['EPF_EMPLOYER/EMPLOYER'],
					'employer EPF excludes OT arrears'
				);
				assert.equal(
					ot.marchOwn['HRDF_EMPLOYER/EMPLOYER'],
					plain.marchOwn['HRDF_EMPLOYER/EMPLOYER'],
					'HRDF excludes OT arrears'
				);
				// PERKESO Act 4 s.2 / EIS Act 800 s.2: SOCSO & EIS include OT arrears (ORDINARY_WAGES)
				assert.ok(
					(ot.marchOwn['SOCSO/EMPLOYEE'] ?? 0) <= (plain.marchOwn['SOCSO/EMPLOYEE'] ?? 0),
					'SOCSO sees OT arrears at ORDINARY_WAGES'
				);
				// Editing the raise in April returns both basic and OT arrears and the exact same EPF refund
				assert.equal(ot.aprilCarriedBack['BASIC/EMPLOYEE'], -300);
				assert.ok((ot.aprilCarriedBack['OVERTIME/EMPLOYEE'] ?? 0) < 0);
				assert.equal(
					ot.aprilCarriedOwn['EPF/EMPLOYEE'],
					plain.aprilCarriedOwn['EPF/EMPLOYEE'],
					'EPF refund on edited raise excludes OT arrears'
				);
			});
		}
	);

	it.live(
		'Singapore: later-signed raise posts line-preserving back pay at ADDITIONAL_WAGES without capping under the S$8,000 OW ceiling',
		() => {
			const sgSeed = pack(
				'SG',
				'Asia/Singapore',
				packTerms(7500),
				{},
				['2026-01', '2026-02', '2026-03']
					.flatMap(weekdays)
					.map((date) => ({ date, shift: WORK, hours: 8 })),
				[]
			);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-01');
				yield* pay(t, '2026-02');
				// Raised to S$8,000 (the OW ceiling) effective 1 Jan, signed 10 Mar -> S$1,000 back pay for Jan+Feb
				yield* raised(t, 8000, '2026-03-10', '2026-01-01');
				yield* pay(t, '2026-03');
				const marchOwn = yield* ownLines(t, '2026-03');
				assert.equal(marchOwn['BASIC/EMPLOYEE'], 8000);
				assert.equal(marchOwn['ADDITIONAL_BACKPAY/EMPLOYEE'], undefined, 'no synthetic ad hoc row');
				assert.deepEqual(yield* backPayFor(t, '2026-03', '2026-01'), { 'BASIC/EMPLOYEE': 500 });
				assert.deepEqual(yield* backPayFor(t, '2026-03', '2026-02'), { 'BASIC/EMPLOYEE': 500 });
				const marchSlip = yield* slip(t, '2026-03');
				const ow = marchSlip.breakdown.checkpoints.find((c) => c.code === 'ORDINARY_WAGES')?.value;
				const aw = marchSlip.breakdown.checkpoints.find(
					(c) => c.code === 'ADDITIONAL_WAGES'
				)?.value;
				assert.equal(ow, 8000, 'ORDINARY_WAGES stays March own OW for December settlement');
				assert.equal(aw, 9000, 'ADDITIONAL_WAGES includes S$1,000 back pay above OW ceiling');
				const cpfAw = marchSlip.breakdown.statutory.find((s) => s.code === 'CPF_AW')?.employer;
				assert.equal(cpfAw, 1000, 'full S$1,000 back pay attracts CPF as Additional Wages');
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed: sgSeed, now: '2026-03-25T02:00:00.000Z' })));
		}
	);

	it.live(
		'chronological simulation: running five months before an amendment and amending in month 5 makes month 6 carry the exact correction matching a never-wrong run',
		() => {
			// Jul–Dec 2026 keeps the law constant across all six months (post-SKBBK) so paid-month and earned-month
			// totals compare one-to-one without a mid-year statutory launch between the earning and paying months.
			const months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'] as const;
			const wrongStart = rostered(months, undefined, 2800, 'MY');
			const neverWrong = rostered(months, '2026-07-14', 2800, 'MY');
			return Effect.gen(function* () {
				const baseline = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					for (const month of months) yield* pay(t, month);
					return {
						net: yield* net(t, ...months),
						lines: yield* paidInAll(t, ...months)
					};
				}).pipe(Effect.provide(workspace({ seed: neverWrong, now: '2026-12-25T02:00:00.000Z' })));

				const t = yield* TestWorkspace;
				// Run Jul–Nov "wrongly" (before the missed 14 Jul overtime is keyed)
				for (const month of ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'] as const)
					yield* pay(t, month);
				const julBefore = yield* slip(t, '2026-07');
				// After Nov is paid, HR keys the missed 14 Jul overtime
				yield* overtimeKeyed(t, '2026-07-14');
				yield* pay(t, '2026-12');
				// July payslip never changed; December carries the exact 2026-07 overtime correction
				assert.equal((yield* slip(t, '2026-07')).net, julBefore.net);
				const decCarriedJul = yield* carriedFor(t, '2026-12', '2026-07');
				assert.ok((decCarriedJul['OVERTIME/EMPLOYEE'] ?? 0) > 0, 'Dec carries Jul missed OT');
				assert.equal(yield* net(t, ...months), baseline.net);
				assert.deepEqual(yield* paidInAll(t, ...months), baseline.lines);
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed: wrongStart, now: '2026-12-25T02:00:00.000Z' })));
		}
	);

	it.live(
		'amending a non-terms entry on a signing month widens the span to cover earlier periods reached by its back pay',
		() => {
			const base = rostered(
				['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
				'2026-07-02',
				1800,
				'MY'
			);
			const cutoffSeed = {
				...base,
				pay_group: (base.pay_group ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day: 21 }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-07');
				yield* pay(t, '2026-08');
				// Late-signed raise effective 1 Jul, signed 1 Sep (September owes Jul + Aug back pay, incl. Jul OT)
				yield* raised(t, 2100, '2026-09-01', '2026-07-01');
				const admin = yield* t.as(t.admin);
				yield* admin.act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: idOf('entity', ENTITY),
							employment_id: STINT,
							catalog_code: 'BONUS',
							description: 'September bonus',
							incurred_on: '2026-09-15',
							quantity: '1000',
							unit: 'MONEY'
						}
					]
				});
				yield* t.run_due();
				yield* pay(t, '2026-09');
				assert.ok((yield* backPayFor(t, '2026-09', '2026-07'))['OVERTIME/EMPLOYEE'] !== undefined);
				// After September is paid, reduce September's bonus: October amends September without touching contract_terms
				const { adhoc_catalog_entry } = yield* storedQuery(t, {
					adhoc_catalog_entry: { where: { catalog_code: { eq: 'BONUS' } }, limit: 1 }
				});
				const [bonus] = adhoc_catalog_entry.rows;
				assert.ok(bonus !== undefined);
				yield* admin.act({
					'adhoc_catalog_entry.update': [
						{ target: { id: bonus.id, revision: bonus.revision }, set: { quantity: '750' } }
					]
				});
				yield* t.run_due();
				yield* pay(t, '2026-10');
				// October carries ONLY the -250 bonus delta and its statutory adjustments; Jul/Aug back pay stays intact
				const carriedBack = yield* carriedBackPayFor(t, '2026-10', '2026-09');
				assert.deepEqual(carriedBack, {}, 're-pricing September must not distort Jul/Aug back pay');
				const carriedOwn = yield* carriedOwnFor(t, '2026-10', '2026-09');
				assert.equal(carriedOwn['BONUS/EMPLOYEE'], -250);
				assert.equal(carriedOwn['PRORATED/EMPLOYEE'], undefined);
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed: cutoffSeed, now: '2026-10-25T02:00:00.000Z' })));
		}
	);
});
