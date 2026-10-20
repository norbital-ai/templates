import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Schema } from 'effect';
import { fieldValue, moneyNumber } from '../src/lib/payroll_engine/foundation.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('MY');
const CODE = 'LOAN_RECOVERY_FESTIVE_ADVANCE';
const GRANT_DATE = PlainDate('2026-03-15');
const COMPANY = nativeId('entity', fixtureId('loan-version-company'));
const PERSON = nativeId('employment_profile', fixtureId('loan-version-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('loan-version-employment'));
const CATALOG = nativeId(
	'loan_catalog',
	LAW.byCode(LAW.versionOn(GRANT_DATE), 'loan_catalog', CODE).id
);
const Pins = Schema.Array(
	Schema.Struct({ collection: Schema.String, id: Schema.String, employment_id: Schema.String })
);

function tables(): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Repayment version employer',
			settings_code: 'MY',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: 1,
			effective_range: { from: '2026-01-01', to: null },
			facts: {
				normal_daily_hours: 8,
				normal_days_per_week: 5,
				hrd_registration_class: 'NOT_REGISTERED'
			}
		}
	]);
	rows.set('employment_profile', [
		{
			id: PERSON,
			name: 'Repayment version employee',
			email: 'loan.version@example.com',
			date_of_birth: '1990-01-01',
			nationality: 'MY',
			gender: 'FEMALE',
			marital_status: 'SINGLE',
			spouse_status: 'NONE',
			children: [],
			facts: {}
		}
	]);
	rows.set('employment_contract', [
		{
			id: EMPLOYMENT,
			employee_id: PERSON,
			company_id: COMPANY,
			employee_number: 'LOAN-VERSION-1',
			contract_number: 1,
			effective_range: { from: '2026-01-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from: '2026-01-01', to: null },
						base_salary: { value: 4000, currency: 'MYR' },
						residency_status: 'CITIZEN',
						work_classification: 'EA_COVERED',
						statutory_work_category: 'NON_MANUAL',
						employment_type: 'PERMANENT',
						facts: { normal_hours_per_day: 8, normal_days_per_week: 5 },
						allowances: []
					}
				]
			}
		}
	]);
	return rows;
}

it.effect(
	'native loan schedules bind each repayment to its date snapshot and preserve captured rows during later edits',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				assert.equal(
					(yield* actor.act('loan_catalog_entry.create', {
						catalog_id: CATALOG,
						employment_id: EMPLOYMENT,
						principal_amount: Decimal.of('600'),
						repayment_period: { from: PlainDate('2026-04-01'), to: PlainDate('2026-09-01') },
						repayment_frequency: 'MONTHLY'
					})).kind,
					'committed'
				);
				const [loan] = (yield* actor.read('loan_catalog_entry', { all: true })).rows;
				assert.ok(loan);
				assert.equal(loan.catalog_id, CATALOG);
				const repayments = (yield* actor.read('loan_repayment_entry', { all: true })).rows.toSorted(
					(a, b) => a.occurred_on.localeCompare(b.occurred_on)
				);
				assert.deepEqual(
					repayments.map((row) => row.occurred_on),
					['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']
				);
				assert.deepEqual(
					repayments.map((row) => LAW.versionOn(row.occurred_on)),
					['version_3', 'version_3', 'version_4', 'version_4', 'version_5', 'version_5']
				);
				assert.deepEqual(
					repayments.map((row) => moneyNumber(row.amount)),
					[100, 100, 100, 100, 100, 100]
				);
				for (const repayment of repayments)
					assert.equal(
						repayment.catalog_id,
						LAW.byCode(LAW.versionOn(repayment.occurred_on), 'loan_catalog', CODE).id
					);
				const [april, , , july, , september] = repayments;
				assert.ok(april && july && september);
				assert.equal(
					(yield* actor.act('loan_catalog_entry.update', {
						target: [loan.id],
						set: {
							repayments: {
								update: [{ target: july.id, set: { occurred_on: PlainDate('2026-07-08') } }]
							}
						}
					})).kind,
					'committed'
				);
				const [moved] = (yield* actor.read('loan_repayment_entry', {
					where: { id: { eq: july.id } },
					all: true
				})).rows;
				assert.ok(moved);
				assert.equal(moved.occurred_on, '2026-07-08');
				assert.equal(moved.catalog_id, LAW.byCode('version_5', 'loan_catalog', CODE).id);
				assert.equal(
					(yield* actor.act('loan_catalog_entry.update', {
						target: [loan.id],
						set: {
							repayments: {
								delete: [july.id],
								create: [{ occurred_on: PlainDate('2026-07-07'), amount: Decimal.of('100') }]
							}
						}
					})).kind,
					'committed'
				);
				const manual = (yield* actor.read('loan_repayment_entry', { all: true })).rows;
				assert.equal(manual.length, 6);
				assert.equal(
					manual.some((row) => row.id === july.id),
					false
				);
				const replacement = manual.find((row) => row.occurred_on === '2026-07-07');
				assert.ok(replacement);
				assert.equal(replacement.catalog_id, LAW.byCode('version_4', 'loan_catalog', CODE).id);
				assert.equal(
					(yield* actor.act('payroll_run.create', {
						company_id: COMPANY,
						period: '2026-04',
						kind: 'REGULAR'
					})).kind,
					'committed'
				);
				const [run] = (yield* actor.read('payroll_run', { select: { pins: true }, all: true }))
					.rows;
				assert.ok(run);
				const pins = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(run.pins, 'payroll_run.pins'))
				);
				assert.ok(
					pins.some((pin) => pin.collection === 'loan_repayment_entry' && pin.id === april.id)
				);
				const [captured] = (yield* actor.read('loan_repayment_entry', {
					where: { id: { eq: april.id } },
					all: true
				})).rows;
				assert.ok(captured);
				assert.equal(captured.payslip_id, null);
				assert.equal(
					(yield* actor.act('loan_catalog_entry.update', {
						target: [loan.id],
						set: {
							principal_amount: Decimal.of('700'),
							repayments: { update: [{ target: september.id, set: { amount: Decimal.of('200') } }] }
						}
					})).kind,
					'committed'
				);
				const final = (yield* actor.read('loan_repayment_entry', { all: true })).rows;
				assert.deepEqual(
					final.find((row) => row.id === captured.id),
					captured
				);
				assert.equal(
					final.reduce((total, row) => {
						const amount = moneyNumber(row.amount);
						assert.ok(amount !== null);
						return total + amount;
					}, 0),
					700
				);
				for (const repayment of final)
					assert.equal(
						repayment.catalog_id,
						LAW.byCode(LAW.versionOn(repayment.occurred_on), 'loan_catalog', CODE).id
					);
				const [updatedLoan] = (yield* actor.read('loan_catalog_entry', { all: true })).rows;
				assert.ok(updatedLoan);
				assert.equal(updatedLoan.catalog_id, CATALOG);
				assert.equal(moneyNumber(updatedLoan.principal_amount), 700);
			})
		);
	}),
	15_000
);
