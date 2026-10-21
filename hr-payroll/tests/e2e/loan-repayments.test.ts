// @vitest-environment happy-dom
/** The loan repayment editor in the real shell: two columns, add/remove, locked payroll rows and semantic Save gating. */
import { expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';
import { flushSync } from 'svelte';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { visit, type ShellMountConfig } from '@norbital-ai/bolt/test/browser';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal, sum } from '@norbital-ai/std/decimal';
import english from '../../src/i18n/+messages.js';
import { fixtureId, nativeId } from '../fixture_values.js';
import { lineage, world, type Tables } from '../jurisdiction_kit.js';

const LAW = lineage('SG');
const COMPANY = nativeId('entity', fixtureId('loan-ui-company'));
const PERSON = nativeId('employment_profile', fixtureId('loan-ui-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('loan-ui-employment'));
const LOAN = nativeId('loan_catalog_entry', fixtureId('loan-ui-principal'));
const RUN = nativeId('payroll_run', fixtureId('loan-ui-paid-run'));
const SLIP = nativeId('payslip', fixtureId('loan-ui-paid-slip'));
const PERIOD = { from: PlainDate('2026-01-31'), to: PlainDate('2026-04-30') };
const VERSION = LAW.versionOn(PERIOD.from);
const CATALOG = nativeId('loan_catalog', LAW.byCode(VERSION, 'loan_catalog', 'SALARY_ADVANCE').id);
const REPAYMENTS = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'].map((date, index) => ({
	id: fixtureId(`loan-ui-repayment-${index}`),
	date,
	amount: index === 0 ? '100' : '300'
}));
const [LOCKED, SECOND, THIRD] = REPAYMENTS;

function tables(): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Loan UI company',
			settings_code: 'SG',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set('employment_profile', [
		{
			id: PERSON,
			name: 'Loan UI employee',
			email: 'loan.ui@example.com',
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
			employee_number: 'LOAN-UI-1',
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
		REPAYMENTS.map((row, index) => ({
			id: row.id,
			loan_id: LOAN,
			catalog_id: CATALOG,
			company_id: COMPANY,
			employment_id: EMPLOYMENT,
			occurred_on: row.date,
			amount: row.amount,
			activity: 'AWARD',
			payslip_id: index === 0 ? SLIP : null
		}))
	);
	return rows;
}

type RepresentationLoader = NonNullable<ShellMountConfig['representations']>[string];
const representations = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<RepresentationLoader>>>(
			'../../src/data/collection/**/+representation.svelte'
		)
	).map(([path, load]) => [
		path.replace('/+representation.svelte', '').split('/').at(-1) ?? path,
		load
	])
);

const editor = () => document.querySelector<HTMLElement>('[data-loan-repayments]');
const dataRows = () =>
	Array.from(editor()?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []).filter(
		(row) => row.querySelector('[data-repayment-date]') !== null
	);
const amountInput = (id: string) =>
	editor()?.querySelector<HTMLInputElement>(`[data-repayment-amount="${id}"] input`) ?? null;
const totalIssue = () =>
	editor()?.querySelector<HTMLElement>('[data-repayment-total] [data-semantic-issue]') ?? null;
const save = () =>
	Array.from(
		document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Editing"] button')
	).at(-1) ?? null;
const settle = (check: () => void) =>
	Effect.promise(() =>
		vi.waitFor(() => {
			flushSync();
			check();
		})
	);
const type = (input: HTMLInputElement | null, text: string) => {
	if (input === null) throw new Error('Missing repayment amount input');
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('blur'));
	flushSync();
};

it.live(
	'loan repayments edit as Amount and Date rows and Save follows the principal invariant',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				if (LOCKED === undefined || SECOND === undefined || THIRD === undefined)
					return yield* Effect.die(new Error('The fixture seeds four repayments.'));
				const admin = t.admin;
				if (admin.actor.kind !== 'member')
					return yield* Effect.die(new Error('UI journey requires a member'));
				t.clock.set(new Date().toISOString());
				yield* visit(
					`/app/hr_controller/events/loans?record=loan_catalog_entry/${LOAN}`,
					{ ...admin, id: admin.actor.id },
					{
						pages: {
							'hr_controller/events/loans': () =>
								import('../../src/app/hr_controller/events/+loans.page.svelte')
						},
						representations,
						messages: english
					}
				);
				yield* settle(() => expect(dataRows()).toHaveLength(4));

				const headers = Array.from(editor()?.querySelectorAll('thead th') ?? [])
					.map((cell) => cell.textContent?.trim() ?? '')
					.filter((text) => text !== '');
				expect(headers).toEqual([english['loan.repayment_amount'], english['loan.column_date']]);

				Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
					.find((button) => button.textContent?.trim() === 'Edit')
					?.click();
				yield* settle(() =>
					expect(editor()?.querySelectorAll('[data-repayment-remove]')).toHaveLength(3)
				);

				const locked = editor()?.querySelector(`[data-repayment-date="${LOCKED.id}"]`);
				expect(locked?.hasAttribute('data-locked')).toBe(true);
				expect(locked?.querySelector('[data-repayment-remove]')).toBeNull();
				expect(locked?.querySelector('[data-repayment-payslip]')).not.toBeNull();
				// a repayment on a payslip shows its values: no amount box, no calendar to pick a date from
				expect(amountInput(LOCKED.id)).toBeNull();
				expect(locked?.querySelector('input, [data-date-input]')).toBeNull();
				expect(totalIssue()).toBeNull();

				type(amountInput(SECOND.id), '250');
				yield* settle(() =>
					expect(totalIssue()?.getAttribute('aria-label')).toBe(
						english['loan.total_mismatch']
							.replace('{total}', Decimal.of('950').round(2).toString())
							.replace('{principal}', Decimal.of('1000').round(2).toString())
					)
				);
				expect(save()?.disabled).toBe(true);

				type(amountInput(THIRD.id), '350');
				yield* settle(() => expect(totalIssue()).toBeNull());
				expect(save()?.disabled).toBe(false);

				editor()?.querySelector<HTMLButtonElement>('[data-repayment-add]')?.click();
				yield* settle(() => expect(dataRows()).toHaveLength(5));
				expect(dataRows().at(-1)?.querySelectorAll('[data-semantic-issue]')).toHaveLength(2);
				expect(save()?.disabled).toBe(true);
				dataRows().at(-1)?.querySelector<HTMLButtonElement>('[data-repayment-remove]')?.click();
				yield* settle(() => expect(dataRows()).toHaveLength(4));
				expect(save()?.disabled).toBe(false);

				editor()
					?.querySelector<HTMLButtonElement>(`[aria-label="${english['loan.recalculate']}"]`)
					?.click();
				yield* settle(() => {
					const unpaid = [SECOND, THIRD, REPAYMENTS[3]].map((row) =>
						Decimal.of((amountInput(row?.id ?? '')?.value ?? '').replace(/,/g, ''))
					);
					expect(unpaid.every((amount) => amount.eq(Decimal.of('300')))).toBe(true);
					expect(sum([Decimal.of('100'), ...unpaid]).eq(Decimal.of('1000'))).toBe(true);
				});
				expect(totalIssue()).toBeNull();

				// Cancel discards the draft: editing again starts from the stored schedule
				type(amountInput(SECOND.id), '250');
				Array.from(
					document.querySelectorAll<HTMLButtonElement>(
						'[role="group"][aria-label="Editing"] button'
					)
				)
					.at(0)
					?.click();
				// the shell asks in-app (never window.confirm) before discarding a dirty draft
				yield* settle(() => expect(document.querySelector('[data-confirm-accept]')).not.toBeNull());
				document.querySelector<HTMLButtonElement>('[data-confirm-accept]')?.click();
				yield* settle(() => expect(amountInput(SECOND.id)).toBeNull());
				Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
					.find((button) => button.textContent?.trim() === 'Edit')
					?.click();
				yield* settle(() =>
					expect(
						[SECOND, THIRD].every((row) =>
							Decimal.of((amountInput(row.id)?.value ?? '').replace(/,/g, '')).eq(Decimal.of('300'))
						)
					).toBe(true)
				);
			}).pipe(Effect.scoped)
		),
	{ timeout: 120_000 }
);
