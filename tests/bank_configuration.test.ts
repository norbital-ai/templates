import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const BANK = nativeId('bank', fixtureId('shared-bank'));
const COMPANIES = [0, 1].map((index) =>
	nativeId('entity', fixtureId(`shared-bank-company-${index}`))
);
const PEOPLE = [0, 1].map((index) =>
	nativeId('employment_profile', fixtureId(`shared-bank-person-${index}`))
);
const EMPLOYMENTS = [0, 1].map((index) =>
	nativeId('employment_contract', fixtureId(`shared-bank-contract-${index}`))
);
const RUNS = [0, 1].map((index) => nativeId('payroll_run', fixtureId(`shared-bank-run-${index}`)));
const SLIPS = [0, 1].map((index) => nativeId('payslip', fixtureId(`shared-bank-slip-${index}`)));
const template = {
	file: '"payments.txt"',
	format: 'FIXED',
	columns: [
		{ header: 'payer', value: 'company.disbursement_account.bank_account_number', width: 12 },
		{ header: 'beneficiary', value: 'contract.bank.bank_account_number', width: 12 },
		{
			header: 'amount',
			value: 'string(int(totals.net * 100.0))',
			width: 8,
			align: 'right',
			pad: '0'
		}
	]
} as const;

function tables(): Tables {
	const rows = LAW.law();
	rows.set('bank', [
		{
			id: BANK,
			code: 'SYNTHETIC-PAYROLL',
			name: 'Synthetic shared bank format',
			bank_codes: ['TESTPAYER'],
			currencies: ['SGD'],
			enabled: true,
			template
		}
	]);
	rows.set(
		'entity',
		COMPANIES.map((id, index) => ({
			id,
			name: `Example company ${index + 1}`,
			settings_code: 'SG',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {},
			payment_bank_id: BANK,
			disbursement_account: {
				bank_name: 'Example payer bank',
				bank_code: 'TESTPAYER',
				bank_account_number: `00000000000${index + 1}`,
				bank_account_name: `Example company ${index + 1}`
			}
		}))
	);
	rows.set(
		'employment_profile',
		PEOPLE.map((id, index) => ({
			id,
			name: `Example employee ${index + 1}`,
			email: `bank-${index}@example.com`,
			date_of_birth: '1990-01-01',
			nationality: 'SG',
			facts: {}
		}))
	);
	rows.set(
		'employment_contract',
		EMPLOYMENTS.map((id, index) => ({
			id,
			employee_id: PEOPLE[index],
			company_id: COMPANIES[index],
			employee_number: `BANK-00${index + 1}`,
			contract_number: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {},
			bank: {
				bank_name: 'Example beneficiary bank',
				bank_code: 'TESTBANK',
				bank_account_number: `00000000001${index + 1}`,
				bank_account_name: `Example employee ${index + 1}`
			}
		}))
	);
	rows.set(
		'payroll_run',
		RUNS.map((id, index) => ({
			id,
			company_id: COMPANIES[index],
			settings_id: LAW.settingsOf(LAW.versionOn('2026-03-31')).id,
			period: '2026-03',
			kind: 'REGULAR',
			pay_date: '2026-03-31'
		}))
	);
	rows.set(
		'payslip',
		SLIPS.map((id, index) => ({
			id,
			payroll_run_id: RUNS[index],
			employment_id: EMPLOYMENTS[index],
			terms_through: '2026-03-31',
			currency: 'SGD',
			gross: '1000',
			total_deductions: '100',
			net: '900',
			employer_cost: '1200',
			bank_charges: '0',
			status: 'DRAFT'
		}))
	);
	return rows;
}

it.effect(
	'refuses duplicate bank filenames across regular and extra payroll rather than renaming or losing payments',
	Effect.fnUntraced(function* () {
		const fixture = tables();
		const company = COMPANIES[0];
		const extraRun = fixture.get('payroll_run')?.find((row) => row.id === RUNS[1]);
		const extraEmployment = fixture
			.get('employment_contract')
			?.find((row) => row.id === EMPLOYMENTS[1]);
		assert.ok(company);
		assert.ok(extraRun);
		assert.ok(extraEmployment);
		extraRun.company_id = company;
		extraRun.kind = 'OFF_CYCLE';
		extraEmployment.company_id = company;
		yield* world(fixture).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const failure = yield* Effect.flip(
					hr.query('payroll_run.export_payroll', { ids: RUNS, kind: 'BANK' })
				);
				assert.match(String(failure), /same bank-file name/);
				for (const id of RUNS) {
					const individual = yield* hr.query('payroll_run.export_payroll', {
						ids: [id],
						kind: 'BANK'
					});
					assert.equal(individual.documents.length, 1);
					assert.equal(individual.documents[0]?.name, 'payments.txt');
					assert.ok(individual.documents[0]?.content.endsWith('00090000'));
				}
				yield* hr.act('bank.update', {
					target: BANK,
					set: {
						template: {
							...template,
							file: 'runs[0].kind == "REGULAR" ? "Payments.txt" : "payments.txt"'
						}
					}
				});
				const caseCollision = yield* Effect.flip(
					hr.query('payroll_run.export_payroll', { ids: RUNS, kind: 'BANK' })
				);
				assert.match(String(caseCollision), /same bank-file name/);
			})
		);
	}),
	15_000
);

it.effect(
	'entities reuse one native bank template without changing captured payroll amounts',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const batchTemplate = { ...template, file: 'company.name + ".txt"' };
				yield* hr.act('bank.update', { target: BANK, set: { template: batchTemplate } });
				const exportBank = () =>
					hr.query('payroll_run.export_payroll', { ids: RUNS, kind: 'BANK' });
				const captured = () =>
					t.storedRead('payslip', {
						where: { id: { in: SLIPS } },
						select: { gross: true, total_deductions: true, net: true, employer_cost: true },
						all: true
					});
				const before = (yield* captured()).rows;
				let output = yield* exportBank();
				assert.equal(output.documents.length, 2);
				assert.deepEqual(output.documents.map((document) => document.name).sort(), [
					'Example company 1.txt',
					'Example company 2.txt'
				]);
				assert.deepEqual(output.documents.map((document) => document.content).sort(), [
					'00000000000100000000001100090000',
					'00000000000200000000001200090000'
				]);
				const changed = yield* hr.act('bank.update', {
					target: BANK,
					set: {
						template: {
							...batchTemplate,
							columns: [{ header: 'format version', value: '"B"', width: 1 }, ...template.columns]
						}
					}
				});
				assert.equal(changed.kind, 'committed');
				output = yield* exportBank();
				assert.equal(output.documents.length, 2);
				assert.deepEqual(output.documents.map((document) => document.name).sort(), [
					'Example company 1.txt',
					'Example company 2.txt'
				]);
				assert.ok(
					output.documents.every((document) => document.content.startsWith('B00000000000'))
				);
				assert.deepEqual((yield* captured()).rows, before);
				// A disabled selection cannot silently use a jurisdiction's legacy layout instead.
				yield* hr.act('bank.update', { target: BANK, set: { enabled: false } });
				assert.ok(yield* Effect.flip(exportBank()));
				yield* hr.act('bank.update', { target: BANK, set: { enabled: true, currencies: ['USD'] } });
				assert.ok(yield* Effect.flip(exportBank()));
				assert.deepEqual((yield* captured()).rows, before);
			})
		);
	}),
	15_000
);

it.effect(
	'an entity cannot select a missing bank or use a selected template with another payer bank',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const company = COMPANIES[0];
				const run = RUNS[0];
				assert.ok(company);
				assert.ok(run);
				assert.ok(
					yield* Effect.flip(
						hr.act('entity.update', {
							target: company,
							set: {
								payment_bank_id: nativeId('bank', fixtureId('missing-bank'))
							}
						})
					)
				);
				yield* hr.act('entity.update', {
					target: company,
					set: {
						disbursement_account: {
							bank_name: 'Other example bank',
							bank_code: 'OTHERBANK',
							bank_account_number: '000000000001',
							bank_account_name: 'Example company 1'
						}
					}
				});
				assert.ok(
					yield* Effect.flip(hr.query('payroll_run.export_payroll', { ids: [run], kind: 'BANK' }))
				);
				const selected = (yield* t.storedRead('entity', {
					where: { id: { eq: company } },
					all: true
				})).rows[0];
				assert.equal(selected?.payment_bank_id, BANK);
			})
		);
	}),
	15_000
);
