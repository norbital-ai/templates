import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Decimal } from '@norbital-ai/std/decimal';
import { Instant } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const COMPANY = nativeId('entity', fixtureId('bank-fee-company'));
const PERSON = nativeId('employment_profile', fixtureId('bank-fee-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('bank-fee-employment'));
const RUN = nativeId('payroll_run', fixtureId('bank-fee-run'));
const SLIP = nativeId('payslip', fixtureId('bank-fee-slip'));

function tables(): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Bank fee test company',
			settings_code: 'SG',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set('employment_profile', [
		{
			id: PERSON,
			name: 'Example employee',
			email: 'bank-fee@example.com',
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
			employee_number: 'FEE-001',
			contract_number: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set('payroll_run', [
		{
			id: RUN,
			company_id: COMPANY,
			settings_id: LAW.settingsOf(LAW.versionOn('2026-03-31')).id,
			period: '2026-03',
			kind: 'REGULAR'
		}
	]);
	rows.set('payslip', [
		{
			id: SLIP,
			payroll_run_id: RUN,
			employment_id: EMPLOYMENT,
			terms_through: '2026-03-31',
			currency: 'SGD',
			gross: '1000',
			total_deductions: '100',
			net: '900',
			employer_cost: '1200',
			status: 'DRAFT'
		}
	]);
	return rows;
}

it.effect(
	'company bank fees remain separate from pay, preserve unknown and zero, and lock when paid',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const controller = t.as(t.member(['hr_controller']));
				const read = () => t.storedRead('payslip', { where: { id: { eq: SLIP } }, all: true });
				assert.equal((yield* read()).rows[0]?.bank_charges, null);
				const changed = yield* controller.act('payslip.update', {
					target: SLIP,
					set: { bank_charges: Decimal.of('50') }
				});
				assert.equal(changed.kind, 'committed');
				let row = (yield* read()).rows[0];
				assert.ok(row);
				assert.equal(row.bank_charges?.toNumber(), 50);
				assert.equal(row.gross.toNumber(), 1000);
				assert.equal(row.net.toNumber(), 900);
				assert.equal(row.total_deductions.toNumber(), 100);
				assert.equal(row.employer_cost.toNumber(), 1200);
				yield* controller.act('payslip.update', { target: SLIP, set: { bank_charges: null } });
				assert.equal((yield* read()).rows[0]?.bank_charges, null);
				yield* controller.act('payslip.update', {
					target: SLIP,
					set: { bank_charges: Decimal.of('0') }
				});
				assert.equal((yield* read()).rows[0]?.bank_charges?.toNumber(), 0);
				const invalid = yield* Effect.flip(
					controller.act('payslip.update', {
						target: SLIP,
						set: { bank_charges: Decimal.of('-1') }
					})
				);
				assert.ok(invalid);
				assert.equal((yield* read()).rows[0]?.bank_charges?.toNumber(), 0);
				yield* hr.act('payslip.update', {
					target: SLIP,
					set: { bank_charges: Decimal.of('50'), status: 'ON_HOLD' }
				});
				yield* hr.act('payroll_run.update', { target: RUN, set: { warnings: 'Reviewed payroll' } });
				assert.equal((yield* read()).rows[0]?.bank_charges?.toNumber(), 50);
				yield* hr.act('payslip.update', {
					target: SLIP,
					set: { status: 'PAID', paid_at: Instant('2026-03-31T00:00:00.000Z') }
				});
				yield* Effect.flip(
					controller.act('payslip.update', {
						target: SLIP,
						set: { bank_charges: Decimal.of('60') }
					})
				);
				row = (yield* read()).rows[0];
				assert.ok(row);
				assert.equal(row.bank_charges?.toNumber(), 50);
				assert.equal(row.gross.toNumber(), 1000);
				assert.equal(row.net.toNumber(), 900);
			})
		);
	}),
	15_000
);
