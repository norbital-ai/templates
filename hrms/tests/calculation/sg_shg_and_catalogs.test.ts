// Singapore SHGs (CDAC, ECF, MBMF, SINDA), statutory NET placement, salary listing columns, and SG catalogs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	calculatePayroll,
	type PayrollInput
} from '../../src/data/model/payroll_run/service/engine.ts';
import { breakdownOf } from '../../src/data/model/payroll_run/service/payslip_breakdown.ts';
import {
	workbookOf,
	type Sheet
} from '../../src/data/model/payroll_run/service/exports/salary_listing_export.ts';
import { evaluate } from '../../src/data/model/jurisdiction/service/expressions.ts';
import type { JsonObject } from '../../src/lib/foundation.ts';
import { lawAt } from '../kit.ts';

const sgLaw = lawAt('SG', '2026-06-25');

const sgInput = (
	options: {
		readonly salary?: number;
		readonly residency?: string;
		readonly pass?: string | null;
		readonly race?: string | null;
		readonly religion?: string | null;
		readonly extraParams?: JsonObject;
		readonly allowances?: Record<string, { readonly amount: number }>;
		readonly adhoc?: readonly JsonObject[];
		readonly claim?: readonly JsonObject[];
	} = {}
): PayrollInput => ({
	run: {
		id: 'run-sg',
		entity_id: 'entity-sg',
		pay_date: '2026-06-25',
		salary_coverage: { from: '2026-06-01', to: '2026-06-30' }
	},
	settings: sgLaw.settings,
	subtotals: sgLaw.rows.subtotal,
	allowance: sgLaw.rows.allowance_catalog,
	overtime: sgLaw.rows.overtime_catalog,
	statutory: sgLaw.rows.statutory_contribution_catalog,
	leave_catalog: sgLaw.rows.leave_catalog,
	claim_catalog: sgLaw.rows.claim_catalog,
	adhoc_catalog: sgLaw.rows.adhoc_catalog,
	loan_catalog: sgLaw.rows.loan_catalog,
	employee: { id: 'emp-sg', date_of_birth: '1990-01-01', gender: 'MALE' },
	employment: {
		id: 'stint-sg',
		effective_range: { from: '2024-01-01', to: null },
		engagement: 'EMPLOYEE',
		payroll: { date_of_birth: '1990-01-01', gender: 'MALE' },
		terms: {
			rate: { amount: options.salary ?? 5000, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 40,
			normal_days_per_week: 5,
			residency_status: options.residency ?? 'CITIZEN',
			...(options.pass == null ? {} : { work_authorisation_category: options.pass }),
			...(options.allowances === undefined ? {} : { allowances: options.allowances })
		},
		statutory_parameters: {
			...(options.race == null ? {} : { race: options.race }),
			...(options.religion == null ? {} : { religion: options.religion }),
			...(options.extraParams ?? {})
		}
	},
	employer: { id: 'entity-sg', statutory_parameters: {} },
	balance: { id: 'bal-sg', account: {} },
	entries: {
		...(options.adhoc === undefined ? {} : { adhoc_catalog_entry: options.adhoc }),
		...(options.claim === undefined ? {} : { claim_catalog_entry: options.claim })
	}
});

const statOf = (res: ReturnType<typeof calculatePayroll>, code: string) =>
	res.statutory.find((row) => row.code === code)?.employee ?? 0;

describe('SG self-help groups, subtotals and catalogues', () => {
	it('normalizes race/religion case, handles double-barrelled NRIC first component, SINDA spellings and overlapping MBMF', () => {
		// Mixed-case Chinese citizen ($5,000 -> CDAC $1.50)
		assert.equal(statOf(calculatePayroll(sgInput({ race: 'Chinese' })), 'CDAC'), 1.5);
		// Double-barrelled Chinese-Indian -> first component Chinese -> CDAC only
		const cnIn = calculatePayroll(sgInput({ race: 'Chinese-Indian' }));
		assert.equal(statOf(cnIn, 'CDAC'), 1.5);
		assert.equal(statOf(cnIn, 'SINDA'), 0);
		// Double-barrelled Indian-Chinese -> first component Indian -> SINDA ($5,000 -> $9)
		const inCn = calculatePayroll(sgInput({ race: 'Indian-Chinese' }));
		assert.equal(statOf(inCn, 'SINDA'), 9);
		assert.equal(statOf(inCn, 'CDAC'), 0);
		// Sino-Indian -> CDAC (not split away from SINO INDIAN)
		assert.equal(statOf(calculatePayroll(sgInput({ race: 'Sino-Indian' })), 'CDAC'), 1.5);
		// Anglo-Chinese -> ECF ($5,000 -> $12)
		assert.equal(statOf(calculatePayroll(sgInput({ race: 'Anglo-Chinese' })), 'ECF'), 12);
		// Official CPF Board / SINDA Fund Rules spellings: Goanese & Telegu (EP holder eligible for SINDA)
		assert.equal(
			statOf(
				calculatePayroll(
					sgInput({ residency: 'FOREIGNER', pass: 'EMPLOYMENT_PASS', race: 'Goanese' })
				),
				'SINDA'
			),
			9
		);
		assert.equal(
			statOf(
				calculatePayroll(
					sgInput({ residency: 'FOREIGNER', pass: 'EMPLOYMENT_PASS', race: 'Telegu' })
				),
				'SINDA'
			),
			9
		);
		// Overlapping Indian Muslim -> BOTH SINDA ($9) and MBMF ($19.50)
		const inMuslim = calculatePayroll(sgInput({ race: 'Indian', religion: 'Muslim' }));
		assert.equal(statOf(inMuslim, 'SINDA'), 9);
		assert.equal(statOf(inMuslim, 'MBMF'), 19.5);
		// MBMF intern exemption applies ONLY to MUIS's 9 local institutions, never OTHER
		const internOther = calculatePayroll(
			sgInput({
				religion: 'ISLAM',
				extraParams: {
					student_training_class: 'LOCAL_APPROVED_TRAINING',
					student_training_approved: true,
					student_training_evidence: 'LETTER-1',
					student_training_institution: 'OTHER'
				}
			})
		);
		assert.equal(statOf(internOther, 'MBMF'), 19.5);
		const internNus = calculatePayroll(
			sgInput({
				religion: 'ISLAM',
				extraParams: {
					student_training_class: 'LOCAL_APPROVED_TRAINING',
					student_training_approved: true,
					student_training_evidence: 'LETTER-1',
					student_training_institution: 'NUS'
				}
			})
		);
		assert.equal(statOf(internNus, 'MBMF'), 0);
	});

	it('keeps SG GROSS checkpoint at gross earnings and emits clean salary listing columns without a bogus GROSS EARNINGS total', () => {
		const res = calculatePayroll(
			sgInput({
				salary: 5000,
				race: 'Chinese',
				allowances: { TRANSPORT_ALLOWANCE: { amount: 300 } },
				adhoc: [
					{
						id: 'a1',
						catalog_code: 'AWS',
						unit: 'MONEY',
						quantity: 5000,
						incurred_on: '2026-06-25'
					},
					{
						id: 'a2',
						catalog_code: 'COMMUNITY_CHEST',
						unit: 'MONEY',
						quantity: 10,
						incurred_on: '2026-06-25'
					},
					{
						id: 'a3',
						catalog_code: 'STATUTORY_ADJUSTMENT',
						unit: 'MONEY',
						quantity: 5,
						incurred_on: '2026-06-25'
					}
				],
				claim: [
					{
						id: 'c1',
						catalog_code: 'DENTAL_CLAIM',
						unit: 'MONEY',
						quantity: 80,
						incurred_on: '2026-06-15'
					},
					{
						id: 'c2',
						catalog_code: 'EXPENSE_REIMBURSEMENT',
						unit: 'MONEY',
						quantity: 45,
						incurred_on: '2026-06-16'
					}
				]
			})
		);
		const grossPoint = res.subtotals.find((s) => s.code === 'GROSS')?.value;
		const owPoint = res.subtotals.find((s) => s.code === 'ORDINARY_WAGES')?.value;
		const awPoint = res.subtotals.find((s) => s.code === 'ADDITIONAL_WAGES')?.value;
		assert.equal(owPoint, 5300);
		assert.equal(awPoint, 10300);
		assert.equal(
			grossPoint,
			10300,
			'GROSS checkpoint must stay at gross earnings, not net after CPF/SHG'
		);
		assert.equal(statOf(res, 'CDAC'), 3);
		assert.equal(statOf(res, 'CPF'), 2060);
		assert.equal(res.net_pay, 10300 - 2060 - 3 - 10 - 5 + 80 + 45);

		const sheet: Sheet = {
			company: 'SG Co',
			currency: 'SGD',
			period: '2026-06',
			offCycle: false,
			people: [
				{
					position: 'Engineer',
					department: 'Ops',
					code: 'SG001',
					name: 'Tan',
					identity: 'S9000001A',
					joined: '2024-01-01',
					left: '',
					breakdown: breakdownOf(res),
					gross: grossPoint ?? 0,
					net: res.net_pay,
					tax: 0,
					contributions: 2063,
					employer: res.employer_cost
				}
			]
		};
		const wb = workbookOf([sheet]);
		const ws = wb.getWorksheet('JUN 2026');
		assert.ok(ws);
		const headers = Array.from({ length: ws.columnCount }, (_, i) =>
			String(ws.getRow(4).getCell(i + 1).value ?? '')
		);
		assert.ok(headers.includes('CDAC'));
		assert.ok(headers.includes('CPF'));
		assert.ok(headers.includes('TRANSPORT ALLOWANCE'));
		assert.ok(headers.includes('AWS'));
		assert.ok(headers.includes('COMMUNITY CHEST'));
		assert.ok(headers.includes('DENTAL CLAIM'));
		assert.ok(headers.includes('EXPENSE REIMBURSEMENT'));
		assert.equal(
			headers.includes('GROSS EARNINGS (PERIOD ONLY)'),
			false,
			'must not emit a post-deduction GROSS EARNINGS (PERIOD ONLY) column'
		);
	});

	it('gates FOREIGN_WORKER_LEVY on WORK_PERMIT/S_PASS and SHG_DEDUCTION_REMITTANCE on non-zero SHG deductions', () => {
		const fwl = sgLaw.rows.registered_effect.find((e) => e.code === 'FOREIGN_WORKER_LEVY');
		const shg = sgLaw.rows.registered_effect.find((e) => e.code === 'SHG_DEDUCTION_REMITTANCE');
		if (!fwl || !shg) throw new Error('expected FOREIGN_WORKER_LEVY and SHG_DEDUCTION_REMITTANCE');
		const baseRun = {
			id: 'run-1',
			entity_id: 'ent-1',
			salary_coverage: { from: '2026-06-01', to: '2026-06-30' }
		};
		const evalFwl = (pass: string | null) =>
			evaluate(
				String(fwl.condition),
				'CALCULATION',
				{
					entry: baseRun,
					reads: {
						obligation: [],
						employment: [
							{
								entity_id: 'ent-1',
								effective_range: { from: '2025-01-01', to: null },
								terms: {
									residency_status: 'FOREIGNER',
									...(pass === null ? {} : { work_authorisation_category: pass })
								}
							}
						]
					}
				},
				'FOREIGN_WORKER_LEVY.condition'
			);
		assert.equal(evalFwl(null), false, 'blank pass must not trigger FWL');
		assert.equal(evalFwl('EMPLOYMENT_PASS'), false, 'EP must not trigger FWL');
		assert.equal(evalFwl('S_PASS'), true, 'S Pass triggers FWL');
		assert.equal(evalFwl('WORK_PERMIT'), true, 'Work Permit triggers FWL');

		const evalShg = (statutory: readonly { code: string; employee: number }[]) =>
			evaluate(
				String(shg.condition),
				'CALCULATION',
				{
					entry: baseRun,
					reads: { obligation: [], payslip: [{ breakdown: { statutory } }] }
				},
				'SHG_DEDUCTION_REMITTANCE.condition'
			);
		assert.equal(evalShg([{ code: 'CPF', employee: 1000 }]), false, 'zero SHG skips obligation');
		assert.equal(evalShg([{ code: 'CDAC', employee: 3 }]), true, 'non-zero CDAC raises obligation');
		const raised = evaluate(
			String(shg.effects),
			'CALCULATION',
			{
				entry: baseRun,
				lookup: shg.lookup,
				reads: {
					holiday: [],
					payslip: [
						{ breakdown: { statutory: [{ code: 'CDAC', employee: 1.5 }] } },
						{
							breakdown: {
								statutory: [
									{ code: 'SINDA', employee: 9 },
									{ code: 'MBMF', employee: 19.5 }
								]
							}
						}
					]
				}
			},
			'SHG_DEDUCTION_REMITTANCE.effects'
		);
		assert.ok(Array.isArray(raised));
		const first: unknown = raised[0];
		assert.ok(typeof first === 'object' && first !== null && 'title' in first);
		assert.equal(first.title, 'Self-help group fund remittance: $30.00');
	});
});
