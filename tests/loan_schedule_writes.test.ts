import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { buildLoanSchedule } from '../src/lib/loan_schedule.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const COMPANY = nativeId('entity', fixtureId('loan-write-company'));
const PERSON = nativeId('employment_profile', fixtureId('loan-write-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('loan-write-employment'));
const LOAN = nativeId('loan_catalog_entry', fixtureId('loan-write-principal'));
const RUN = nativeId('payroll_run', fixtureId('loan-write-paid-run'));
const SLIP = nativeId('payslip', fixtureId('loan-write-paid-slip'));
const PERIOD = { from: PlainDate('2026-01-31'), to: PlainDate('2026-04-30') };
const VERSION = LAW.versionOn(PERIOD.from);
const CATALOG = nativeId('loan_catalog', LAW.byCode(VERSION, 'loan_catalog', 'SALARY_ADVANCE').id);

function tables(paid = false): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Loan test company',
			settings_code: 'SG',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set('employment_profile', [
		{
			id: PERSON,
			name: 'Loan test employee',
			email: 'loan.employee@example.com',
			date_of_birth: '1990-01-01',
			nationality: 'SG',
			facts: {}
		}
	]);
	rows.set('employment_contract', [
		{
			id: EMPLOYMENT,
			employee_id: PERSON,
			company_id: COMPANY,
			employee_number: 'LOAN-1',
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
						allowances: []
					}
				]
			}
		}
	]);
	if (!paid) return rows;
	rows.set('payroll_run', [
		{
			id: RUN,
			company_id: COMPANY,
			settings_id: LAW.settingsOf(VERSION).id,
			period: '2026-01',
			kind: 'REGULAR'
		}
	]);
	rows.set('payslip', [
		{
			id: SLIP,
			payroll_run_id: RUN,
			employment_id: EMPLOYMENT,
			terms_through: '2026-01-31',
			currency: 'SGD',
			gross: '4000',
			total_deductions: '100',
			net: '3900',
			employer_cost: '4000',
			status: 'PAID'
		}
	]);
	rows.set('loan_catalog_entry', [
		{
			id: LOAN,
			catalog_id: CATALOG,
			employment_id: EMPLOYMENT,
			company_id: COMPANY,
			principal_amount: '1000',
			repayment_period: PERIOD,
			repayment_frequency: 'MONTHLY'
		}
	]);
	rows.set(
		'loan_repayment_entry',
		['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'].map((date, index) => ({
			id: fixtureId(`loan-write-repayment-${index}`),
			loan_id: LOAN,
			catalog_id: CATALOG,
			company_id: COMPANY,
			employment_id: EMPLOYMENT,
			occurred_on: date,
			amount: index === 0 ? '100' : '300',
			activity: 'AWARD',
			payslip_id: index === 0 ? SLIP : null
		}))
	);
	return rows;
}

it.effect(
	'native loan writes require a balanced final schedule and preserve atomic nested edits',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const created = yield* actor.act('loan_catalog_entry.create', {
					catalog_id: CATALOG,
					employment_id: EMPLOYMENT,
					principal_amount: Decimal.of('1000'),
					repayment_period: PERIOD,
					repayment_frequency: 'MONTHLY',
					advance_made_on: PlainDate('2025-12-31')
				});
				assert.equal(created.kind, 'committed');
				const loans = (yield* t.storedRead('loan_catalog_entry', { all: true })).rows;
				const loan = loans[0];
				assert.ok(loan);
				assert.equal(loan.advance_made_on, '2025-12-31');
				const oldAdvance = yield* Effect.flip(
					actor.act('loan_catalog_entry.create', {
						catalog_id: CATALOG,
						employment_id: EMPLOYMENT,
						principal_amount: Decimal.of('1000'),
						repayment_period: PERIOD,
						repayment_frequency: 'MONTHLY',
						advance_made_on: PlainDate('2024-01-01')
					})
				);
				assert.match(oldAdvance.message, /not available/);
				for (const removed of ['occurred_on', 'reference', 'label'])
					assert.equal(Object.hasOwn(loan, removed), false);
				const repayments = (yield* t.storedRead('loan_repayment_entry', {
					where: { loan_id: { eq: loan.id } },
					all: true
				})).rows.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on));
				for (const repayment of repayments)
					for (const removed of ['reference', 'label', 'facts'])
						assert.equal(Object.hasOwn(repayment, removed), false);
				assert.deepEqual(
					repayments.map((row) => row.amount.toString()),
					['250.00', '250.00', '250.00', '250.00']
				);
				const [first, second] = repayments;
				assert.ok(first && second);
				const invalid = yield* Effect.flip(
					actor.act('loan_repayment_entry.update', {
						target: [first.id],
						set: { amount: Decimal.of('200') }
					})
				);
				assert.match(invalid.message, /total.*principal/i);
				yield* actor.act('loan_repayment_entry.update', [
					{ target: first.id, set: { amount: Decimal.of('200') } },
					{ target: second.id, set: { amount: Decimal.of('300') } }
				]);
				const unbalanced = yield* Effect.flip(
					actor.act('loan_catalog_entry.update', {
						target: [loan.id],
						set: {
							repayments: { update: [{ target: first.id, set: { amount: Decimal.of('100') } }] }
						}
					})
				);
				assert.match(unbalanced.message, /total.*principal/i);
				yield* actor.act('loan_catalog_entry.update', {
					target: [loan.id],
					set: {
						repayments: {
							delete: [first.id],
							create: [{ occurred_on: PlainDate('2026-02-01'), amount: Decimal.of('200') }]
						}
					}
				});
				const outside = yield* Effect.flip(
					actor.act('loan_repayment_entry.update', {
						target: [second.id],
						set: { occurred_on: PlainDate('2026-05-01') }
					})
				);
				assert.match(outside.message, /repayment period/i);
				const before = (yield* t.storedRead('loan_repayment_entry', { all: true })).rows;
				yield* actor.act('loan_catalog_entry.update', {
					target: [loan.id],
					set: { principal_amount: Decimal.of('1000') }
				});
				const after = (yield* t.storedRead('loan_repayment_entry', { all: true })).rows;
				assert.deepEqual(after.map((row) => row.id).sort(), before.map((row) => row.id).sort());
				assert.equal(after.length, 4);
				const employee = t.as(t.member(['employee'], { email: 'loan.employee@example.com' }));
				const stranger = t.as(t.member(['employee'], { email: 'another.employee@example.com' }));
				assert.equal((yield* employee.read('loan_repayment_entry', { all: true })).rows.length, 4);
				assert.equal((yield* stranger.read('loan_repayment_entry', { all: true })).rows.length, 0);
				yield* Effect.flip(
					employee.act('loan_repayment_entry.update', {
						target: [second.id],
						set: { amount: Decimal.of('300') }
					})
				);
			})
		);
	}),
	15_000
);

it.effect(
	'native parent edits redistribute unpaid repayments while preserving paid rows and their period',
	Effect.fnUntraced(function* () {
		yield* world(tables(true)).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const before = (yield* t.storedRead('loan_repayment_entry', { all: true })).rows;
				const paid = before.find((row) => row.payslip_id != null);
				assert.ok(paid);
				const schedule = buildLoanSchedule({
					principal_amount: Decimal.of('1100'),
					repayment_period: PERIOD,
					repayments: before,
					scale: 2,
					semi_monthly_split: 15
				});
				assert.ok(schedule.ok);
				const update = schedule.repayments.flatMap((row) => {
					if (row.payslip_id != null) return [];
					const stored = before.find((child) => child.id === row.id);
					assert.ok(stored);
					return [{ target: stored.id, set: { occurred_on: row.occurred_on, amount: row.amount } }];
				});
				yield* actor.act('loan_catalog_entry.update', {
					target: [LOAN],
					set: { principal_amount: Decimal.of('1100'), repayments: { update } }
				});
				const after = (yield* t.storedRead('loan_repayment_entry', { all: true })).rows;
				assert.deepEqual(
					after.find((row) => row.id === paid.id),
					paid
				);
				assert.deepEqual(
					after
						.filter((row) => row.payslip_id == null)
						.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on))
						.map((row) => row.amount.toString()),
					['333.33', '333.33', '333.34']
				);
				const changedPaid = yield* Effect.flip(
					t.as(t.admin).act('loan_catalog_entry.update', {
						target: [LOAN],
						set: {
							repayments: { update: [{ target: paid.id, set: { amount: Decimal.of('99') } }] }
						}
					})
				);
				assert.match(changedPaid.message, /payslip/i);
				const period = yield* Effect.flip(
					actor.act('loan_catalog_entry.update', {
						target: [LOAN],
						set: {
							repayment_period: { from: PlainDate('2026-02-01'), to: PERIOD.to }
						}
					})
				);
				assert.match(period.message, /repayment period/i);
				const deleted = yield* Effect.flip(
					actor.act('loan_catalog_entry.delete', { target: [LOAN] })
				);
				assert.match(deleted.message, /payslip/i);
			})
		);
	}),
	15_000
);

it.effect(
	'HR can submit an explicit child schedule, while an unbalanced create writes nothing',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const terms = {
					catalog_id: CATALOG,
					employment_id: EMPLOYMENT,
					principal_amount: Decimal.of('500'),
					repayment_period: PERIOD
				};
				yield* actor.act('loan_catalog_entry.create', {
					...terms,
					repayments: {
						create: [
							{ occurred_on: PlainDate('2026-02-28'), amount: Decimal.of('200') },
							{ occurred_on: PlainDate('2026-04-30'), amount: Decimal.of('300') }
						]
					}
				});
				const loans = (yield* t.storedRead('loan_catalog_entry', { all: true })).rows;
				const children = (yield* t.storedRead('loan_repayment_entry', { all: true })).rows;
				assert.equal(loans.length, 1);
				assert.equal(children.length, 2);
				assert.deepEqual(
					children
						.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on))
						.map((row) => [row.occurred_on, row.amount.toNumber()]),
					[
						['2026-02-28', 200],
						['2026-04-30', 300]
					]
				);
				const refused = yield* Effect.flip(
					actor.act('loan_catalog_entry.create', {
						...terms,
						repayments: { create: [{ occurred_on: PERIOD.from, amount: Decimal.of('499.99') }] }
					})
				);
				assert.match(refused.message, /total.*principal/i);
				assert.equal((yield* t.storedRead('loan_catalog_entry', { all: true })).rows.length, 1);
				assert.equal((yield* t.storedRead('loan_repayment_entry', { all: true })).rows.length, 2);
			})
		);
	}),
	15_000
);
