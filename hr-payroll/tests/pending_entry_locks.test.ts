import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Result, Schema } from 'effect';
import { fieldValue, moneyNumber } from '../src/lib/payroll_engine/foundation.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const VERSION = LAW.versionOn('2026-01-31');
const COMPANY = nativeId('entity', fixtureId('pending-lock-company'));
const PERSON = nativeId('employment_profile', fixtureId('pending-lock-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('pending-lock-employment'));
const WORK = nativeId('shift_definition', fixtureId('pending-lock-work'));
const REST = nativeId('shift_definition', fixtureId('pending-lock-rest'));
const PATTERN = nativeId('shift_pattern', fixtureId('pending-lock-pattern'));
const LOAN_CATALOG = nativeId(
	'loan_catalog',
	LAW.byCode(VERSION, 'loan_catalog', 'SALARY_ADVANCE').id
);
const BONUS = {
	catalog_id: nativeId('adhoc_catalog', LAW.byCode(VERSION, 'adhoc_catalog', 'bonus').id),
	employment_id: EMPLOYMENT,
	occurred_on: PlainDate('2026-01-20'),
	amount: Decimal.of('100')
};
const CLAIM = {
	catalog_id: nativeId(
		'claim_catalog',
		LAW.byCode(VERSION, 'claim_catalog', 'MEDICAL_TREATMENT_REIMBURSEMENT').id
	),
	employment_id: EMPLOYMENT,
	occurred_on: PlainDate('2026-01-21'),
	amount: Decimal.of('50'),
	// The class's qualifies_when reads these receipt facts; an entry without them cannot be priced.
	facts: {
		amount_incurred: 50,
		patient: 'EMPLOYEE',
		practitioner_qualified: true,
		treatment: 'MEDICAL',
		treatment_necessary: true,
		solely_aesthetic: false
	}
};
const JANUARY = { company_id: COMPANY, period: '2026-01', kind: 'REGULAR' as const };
const LOCKED = /settled|captured|payroll|payslip/i;
const Pins = Schema.Array(
	Schema.Struct({ collection: Schema.String, id: Schema.String, employment_id: Schema.String })
);

function tables(): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Pending lock employer',
			settings_code: 'SG',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set('employment_profile', [
		{
			id: PERSON,
			name: 'Pending lock employee',
			email: 'pending.employee@example.com',
			date_of_birth: '1990-01-01',
			nationality: 'SG',
			race: 'CHINESE',
			religion: 'OTHER',
			facts: {}
		}
	]);
	rows.set('employment_contract', [
		{
			id: EMPLOYMENT,
			employee_id: PERSON,
			company_id: COMPANY,
			employee_number: 'PENDING-1',
			contract_number: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from: '2020-01-01', to: null },
						base_salary: { value: 4000, currency: 'SGD' },
						residency_status: 'CITIZEN',
						work_classification: 'EA_COVERED',
						statutory_work_category: 'NON_MANUAL',
						employment_type: 'PERMANENT',
						shift_pattern_id: PATTERN,
						allowances: []
					}
				]
			}
		}
	]);
	rows.set('shift_definition', [
		{
			id: WORK,
			company_id: COMPANY,
			code: 'DAY',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
		},
		{ id: REST, company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } }
	]);
	rows.set('shift_pattern', [
		{
			id: PATTERN,
			company_id: COMPANY,
			code: 'WEEK',
			effective_range: { from: '2020-01-06', to: null },
			pattern: {
				days: [
					...Array.from({ length: 5 }, () => ({ roster_code_id: WORK })),
					{ roster_code_id: REST },
					{ roster_code_id: REST }
				]
			}
		}
	]);
	return rows;
}

it.effect(
	'a calculated payroll locks consumed source rows before pin automation and releases only its own rows on deletion',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				assert.equal(
					(yield* actor.act('loan_catalog_entry.create', {
						catalog_id: LOAN_CATALOG,
						employment_id: EMPLOYMENT,
						principal_amount: Decimal.of('1000'),
						repayment_period: {
							from: PlainDate('2026-01-31'),
							to: PlainDate('2026-04-30')
						},
						repayment_frequency: 'MONTHLY'
					})).kind,
					'committed'
				);
				assert.equal((yield* actor.act('adhoc_catalog_entry.create', BONUS)).kind, 'committed');
				assert.equal((yield* actor.act('claim_catalog_entry.create', CLAIM)).kind, 'committed');
				const [claim] = (yield* actor.read('claim_catalog_entry', { all: true })).rows;
				assert.ok(claim);
				const [loan] = (yield* actor.read('loan_catalog_entry', { all: true })).rows;
				const [bonus] = (yield* actor.read('adhoc_catalog_entry', { all: true })).rows;
				assert.ok(loan && bonus);
				const repayments = (yield* actor.read('loan_repayment_entry', { all: true })).rows.toSorted(
					(a, b) => a.occurred_on.localeCompare(b.occurred_on)
				);
				const [due, following, , last] = repayments;
				assert.ok(due && following && last);
				assert.deepEqual(
					repayments.map((row) => moneyNumber(row.amount)),
					[250, 250, 250, 250]
				);
				assert.equal((yield* actor.act('payroll_run.create', JANUARY)).kind, 'committed');
				const [run] = (yield* actor.read('payroll_run', { select: { pins: true }, all: true }))
					.rows;
				assert.ok(run);
				const [slip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: run.id } },
					all: true
				})).rows;
				assert.ok(slip);
				const ledger = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(run.pins, 'payroll_run.pins'))
				);
				assert.ok(
					ledger.some((pin) => pin.collection === 'loan_repayment_entry' && pin.id === due.id)
				);
				assert.ok(
					ledger.some((pin) => pin.collection === 'adhoc_catalog_entry' && pin.id === bonus.id)
				);
				assert.equal(
					(yield* actor.read('loan_repayment_entry', { where: { id: { eq: due.id } }, all: true }))
						.rows[0]?.payslip_id,
					null
				);
				assert.equal(
					(yield* actor.read('adhoc_catalog_entry', { all: true })).rows[0]?.payslip_id,
					null
				);
				assert.match(
					(yield* Effect.flip(
						actor.act('loan_repayment_entry.update', {
							target: [due.id],
							set: { occurred_on: PlainDate('2026-02-01') }
						})
					)).message,
					LOCKED
				);
				assert.match(
					(yield* Effect.flip(
						actor.act('loan_catalog_entry.update', {
							target: [loan.id],
							set: {
								repayments: {
									update: [
										{ target: due.id, set: { amount: Decimal.of('200') } },
										{ target: following.id, set: { amount: Decimal.of('300') } }
									]
								}
							}
						})
					)).message,
					LOCKED
				);
				assert.match(
					(yield* Effect.flip(actor.act('loan_catalog_entry.delete', { target: [loan.id] })))
						.message,
					LOCKED
				);
				assert.match(
					(yield* Effect.flip(
						actor.act('adhoc_catalog_entry.update', {
							target: [bonus.id],
							set: { amount: Decimal.of('150') }
						})
					)).message,
					LOCKED
				);
				assert.match(
					(yield* Effect.flip(actor.act('adhoc_catalog_entry.delete', { target: [bonus.id] })))
						.message,
					LOCKED
				);
				assert.ok(
					ledger.some((pin) => pin.collection === 'claim_catalog_entry' && pin.id === claim.id)
				);
				assert.match(
					(yield* Effect.flip(actor.act('claim_catalog_entry.delete', { target: [claim.id] })))
						.message,
					LOCKED
				);
				assert.equal(
					(yield* actor.act('payroll_run.create', { ...JANUARY, period: '2026-02' })).kind,
					'committed'
				);
				const [otherRun] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-02' } },
					all: true
				})).rows;
				assert.ok(otherRun);
				const [otherSlip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: otherRun.id } },
					all: true
				})).rows;
				assert.ok(otherSlip);
				for (const payslip_id of [null, otherSlip.id]) {
					assert.match(
						(yield* Effect.flip(
							actor.act('loan_repayment_entry.update', { target: [due.id], set: { payslip_id } })
						)).message,
						LOCKED
					);
					assert.match(
						(yield* Effect.flip(
							actor.act('adhoc_catalog_entry.update', { target: [bonus.id], set: { payslip_id } })
						)).message,
						LOCKED
					);
				}
				const capturedBefore = (yield* actor.read('loan_repayment_entry', {
					where: { id: { in: [due.id, following.id] } },
					all: true
				})).rows.toSorted((a, b) => a.id.localeCompare(b.id));
				assert.equal(
					(yield* actor.act('loan_catalog_entry.update', {
						target: [loan.id],
						set: {
							principal_amount: Decimal.of('1100'),
							repayments: { update: [{ target: last.id, set: { amount: Decimal.of('350') } }] }
						}
					})).kind,
					'committed'
				);
				const capturedAfter = (yield* actor.read('loan_repayment_entry', {
					where: { id: { in: [due.id, following.id] } },
					all: true
				})).rows.toSorted((a, b) => a.id.localeCompare(b.id));
				assert.equal(capturedBefore.length, 2);
				assert.deepEqual(capturedAfter, capturedBefore);
				assert.equal(
					moneyNumber(
						(yield* actor.read('loan_repayment_entry', {
							where: { id: { eq: last.id } },
							all: true
						})).rows[0]?.amount
					),
					350
				);
				yield* actor.act('loan_repayment_entry.update', {
					target: [due.id],
					set: { payslip_id: slip.id }
				});
				yield* actor.act('adhoc_catalog_entry.update', {
					target: [bonus.id],
					set: { payslip_id: slip.id }
				});
				assert.equal(
					(yield* actor.read('loan_repayment_entry', { where: { id: { eq: due.id } }, all: true }))
						.rows[0]?.payslip_id,
					slip.id
				);
				assert.equal(
					(yield* actor.read('adhoc_catalog_entry', { all: true })).rows[0]?.payslip_id,
					slip.id
				);
				assert.equal(
					(yield* actor.act('payroll_run.delete', { target: [run.id] })).kind,
					'committed'
				);
				assert.equal((yield* actor.read('payroll_run', { all: true })).rows[0]?.id, otherRun.id);
				yield* actor.act('loan_repayment_entry.update', {
					target: [due.id],
					set: { occurred_on: PlainDate('2026-02-01') }
				});
				yield* actor.act('adhoc_catalog_entry.update', {
					target: [bonus.id],
					set: { amount: Decimal.of('150') }
				});
				const [released] = (yield* actor.read('loan_repayment_entry', {
					where: { id: { eq: due.id } },
					all: true
				})).rows;
				assert.ok(released);
				assert.equal(released.payslip_id, null);
				assert.equal(released.occurred_on, '2026-02-01');
				assert.equal(moneyNumber(released.amount), 250);
				const [releasedBonus] = (yield* actor.read('adhoc_catalog_entry', { all: true })).rows;
				assert.ok(releasedBonus);
				assert.equal(releasedBonus.payslip_id, null);
				assert.equal(moneyNumber(releasedBonus.amount), 150);
				assert.match(
					(yield* Effect.flip(
						actor.act('loan_repayment_entry.update', {
							target: [due.id],
							set: { payslip_id: otherSlip.id }
						})
					)).message,
					LOCKED
				);
				assert.match(
					(yield* Effect.flip(
						actor.act('adhoc_catalog_entry.update', {
							target: [bonus.id],
							set: { payslip_id: otherSlip.id }
						})
					)).message,
					LOCKED
				);
				assert.equal(
					(yield* actor.read('loan_repayment_entry', { where: { id: { eq: due.id } }, all: true }))
						.rows[0]?.payslip_id,
					null
				);
				assert.equal(
					(yield* actor.read('adhoc_catalog_entry', { all: true })).rows[0]?.payslip_id,
					null
				);
			})
		);
	}),
	15_000
);

it.effect(
	'an ad hoc edit racing payroll cannot leave a captured amount different from its source',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				yield* actor.act('adhoc_catalog_entry.create', BONUS);
				const [bonus] = (yield* actor.read('adhoc_catalog_entry', { all: true })).rows;
				assert.ok(bonus);
				const results = yield* Effect.all(
					{
						edit: Effect.result(
							actor.act('adhoc_catalog_entry.update', {
								target: [bonus.id],
								set: { amount: Decimal.of('200') }
							})
						),
						payroll: Effect.result(actor.act('payroll_run.create', JANUARY))
					},
					{ concurrency: 'unbounded' }
				);
				if (Result.isFailure(results.payroll)) {
					assert.ok(Result.isSuccess(results.edit));
					assert.equal(results.edit.success.kind, 'committed');
					assert.match(results.payroll.failure.message, /conflict|changed|retry|concurrent/i);
					assert.equal((yield* actor.read('payroll_run', { all: true })).rows.length, 0);
					assert.equal((yield* actor.read('payslip', { all: true })).rows.length, 0);
					assert.equal((yield* actor.act('payroll_run.create', JANUARY)).kind, 'committed');
				} else {
					assert.equal(results.payroll.success.kind, 'committed');
					if (Result.isFailure(results.edit))
						assert.match(
							results.edit.failure.message,
							/conflict|changed|retry|concurrent|settled|captured|payroll|payslip/i
						);
					else assert.equal(results.edit.success.kind, 'committed');
				}
				const [slip] = (yield* actor.read('payslip', {
					select: { adjustments: true },
					all: true
				})).rows;
				const [stored] = (yield* actor.read('adhoc_catalog_entry', { all: true })).rows;
				assert.ok(slip && stored);
				const adjustments = yield* Effect.fromResult(
					fieldValue(slip.adjustments, 'payslip.adjustments')
				);
				const captured = adjustments?.find(
					(line) => line.family === 'ADHOC' && line.source_id === bonus.id
				);
				assert.ok(captured);
				assert.ok(captured.amount === 100 || captured.amount === 200);
				assert.equal(captured.amount, moneyNumber(stored.amount));
				assert.equal(stored.payslip_id, null);
				assert.equal((yield* actor.read('payroll_run', { all: true })).rows.length, 1);
			})
		);
	}),
	15_000
);

it.effect(
	'a straddling leave locks on first use, prices only the next period’s share and releases after dependent payroll is deleted',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				yield* actor.act('leave_catalog_entry.create', {
					catalog_id: nativeId(
						'leave_catalog',
						LAW.byCode(VERSION, 'leave_catalog', 'UNPAID_LEAVE').id
					),
					employment_id: EMPLOYMENT,
					occurred_on: PlainDate('2026-01-26'),
					activity: 'TIME_OFF',
					from: PlainDate('2026-01-26'),
					to: PlainDate('2026-02-06')
				});
				const [leave] = (yield* actor.read('leave_catalog_entry', { all: true })).rows;
				assert.ok(leave);
				assert.equal(moneyNumber(leave.days), 10);
				yield* actor.act('payroll_run.create', JANUARY);
				const [january] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-01' } },
					select: { pins: true },
					all: true
				})).rows;
				assert.ok(january);
				const [januarySlip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: january.id } },
					all: true
				})).rows;
				assert.ok(januarySlip);
				const januaryPins = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(january.pins, 'payroll_run.pins'))
				);
				assert.ok(
					januaryPins.some((pin) => pin.collection === 'leave_catalog_entry' && pin.id === leave.id)
				);
				const januaryBase = yield* Effect.fromResult(fieldValue(januarySlip.base, 'payslip.base'));
				assert.equal(
					januaryBase?.find((line) => line.component_code === 'NO_PAY_LEAVE')?.quantity,
					5
				);
				assert.equal(moneyNumber(januarySlip.gross), 3090.91);
				assert.equal(
					(yield* actor.read('leave_catalog_entry', { all: true })).rows[0]?.payslip_id,
					null
				);
				assert.match(
					(yield* Effect.flip(
						actor.act('leave_catalog_entry.update', {
							target: [leave.id],
							set: { label: 'Changed after January' }
						})
					)).message,
					LOCKED
				);
				assert.match(
					(yield* Effect.flip(actor.act('leave_catalog_entry.delete', { target: [leave.id] })))
						.message,
					LOCKED
				);
				yield* actor.act('payroll_run.create', { ...JANUARY, period: '2026-02' });
				const [february] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-02' } },
					select: { pins: true },
					all: true
				})).rows;
				assert.ok(february);
				const [februarySlip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: february.id } },
					all: true
				})).rows;
				assert.ok(februarySlip);
				const februaryPins = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(february.pins, 'payroll_run.pins'))
				);
				assert.equal(
					februaryPins.some((pin) => pin.collection === 'leave_catalog_entry'),
					false
				);
				const februaryBase = yield* Effect.fromResult(
					fieldValue(februarySlip.base, 'payslip.base')
				);
				assert.equal(
					februaryBase?.find((line) => line.component_code === 'NO_PAY_LEAVE')?.quantity,
					5
				);
				assert.equal(moneyNumber(februarySlip.gross), 3000);
				yield* actor.act('leave_catalog_entry.update', {
					target: [leave.id],
					set: { payslip_id: januarySlip.id }
				});
				const beforeWrongLink = (yield* actor.read('leave_catalog_entry', {
					where: { id: { eq: leave.id } },
					select: { revision: true, payslip_id: true },
					all: true
				})).rows;
				const wrongLink = yield* Effect.flip(
					actor.act('leave_catalog_entry.update', {
						target: [leave.id],
						set: { payslip_id: februarySlip.id }
					})
				);
				assert.ok(wrongLink._tag === 'ActRefused');
				assert.equal(wrongLink.code, 'forbidden');
				assert.equal(wrongLink.message, 'You may not make this change.');
				assert.deepEqual(
					(yield* actor.read('leave_catalog_entry', {
						where: { id: { eq: leave.id } },
						select: { revision: true, payslip_id: true },
						all: true
					})).rows,
					beforeWrongLink
				);
				assert.match(
					(yield* Effect.flip(actor.act('payroll_run.delete', { target: [january.id] }))).message,
					/2026-02.*first/i
				);
				const [captured] = (yield* actor.read('leave_catalog_entry', { all: true })).rows;
				assert.ok(captured);
				assert.equal(captured.payslip_id, januarySlip.id);
				assert.equal(captured.from, '2026-01-26');
				assert.equal(captured.to, '2026-02-06');
				assert.equal(moneyNumber(captured.days), 10);
				yield* actor.act('payroll_run.create', { ...JANUARY, period: '2026-03' });
				const [march] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-03' } },
					all: true
				})).rows;
				assert.ok(march);
				const [marchSlip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: march.id } },
					all: true
				})).rows;
				assert.ok(marchSlip);
				const marchBase = yield* Effect.fromResult(fieldValue(marchSlip.base, 'payslip.base'));
				assert.equal(
					marchBase?.some((line) => line.component_code === 'NO_PAY_LEAVE'),
					false
				);
				assert.equal(moneyNumber(marchSlip.gross), 4000);
				yield* actor.act('payroll_run.delete', { target: [february.id] });
				yield* actor.act('payroll_run.delete', { target: [january.id] });
				assert.equal(
					(yield* actor.read('leave_catalog_entry', { all: true })).rows[0]?.payslip_id,
					null
				);
				yield* actor.act('leave_catalog_entry.update', {
					target: [leave.id],
					set: { label: 'Released after deleting both affected periods' }
				});
			})
		);
	}),
	15_000
);
