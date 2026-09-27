import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COMPANY_ID,
	createStatutoryWorld,
	type StatutoryBook
} from './fixtures/statutory-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { resolveCompanyFacts } from '../src/lib/declared-facts.ts';

const range = (start: string, end: string | null) => ({
	start: `${start}T00:00:00.000Z`,
	end: end == null ? null : `${end}T00:00:00.000Z`
});

test('a company fact revision governs its own dates and the company row otherwise', () => {
	const fields = [{ key: 'overtime_consent', type: 'boolean' as const, label: 'Consent' }];
	const company = {
		settings_code: 'TW',
		region: null,
		pay_frequency: 'MONTHLY',
		facts: { overtime_consent: false }
	};
	const dated = [
		{ facts: { overtime_consent: true }, effective_range: range('2026-02-01', null) },
		{ facts: { overtime_consent: false }, effective_range: range('2026-01-01', '2026-01-31') }
	];
	assert.equal(
		resolveCompanyFacts(fields, company, { asOf: '2026-01-15', revisions: dated }).overtime_consent,
		false
	);
	assert.equal(
		resolveCompanyFacts(fields, company, { asOf: '2026-02-15', revisions: dated }).overtime_consent,
		true
	);
	// Before the first revision the company row's current standing applies.
	assert.equal(
		resolveCompanyFacts(fields, company, { asOf: '2025-12-01', revisions: dated }).overtime_consent,
		false
	);
	// An undated caller keeps the current record.
	assert.equal(resolveCompanyFacts(fields, company).overtime_consent, false);
});

test('a dated revision prices the run from its own date', () => {
	const world = createStatutoryWorld({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [{ key: 'P', wage: 10_000_000 }]
	});
	world.company_facts = [
		{
			id: 'c0a00000-0000-4000-8000-000000000001',
			company_id: COMPANY_ID,
			facts: { occupational_accident_reduced: true },
			effective_range: range('2026-02-01', null),
			approval_id: null
		}
	] as never;
	const employerSi = (period: string): number => {
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		return slip.statutory.find((row) => row.scheme_code === 'SI')!.employer_amount;
	};
	// 17.5% + 0.5% occupational accident before the revision, 0.3% once it is in force.
	assert.equal(employerSi('2026-01'), 1_750_000);
	assert.equal(employerSi('2026-02'), 1_730_000);
});

test('a dated HRD employer fact retains the optional 1% rate through December', () => {
	const world = createStatutoryWorld({
		code: 'MY',
		period: '2026-08',
		people: [{ key: 'P', wage: 3000, citizenship: 'CITIZEN' }],
		companyFacts: {
			hrd_scope: 'PART_I',
			hrd_registration_class: 'OPTIONAL',
			hrd_form2_count: 8,
			hrd_optional_last_high_year: 0
		}
	});
	world.company_facts = [
		{
			id: 'c0a00000-0000-4000-8000-000000000002',
			company_id: COMPANY_ID,
			facts: {
				hrd_scope: 'PART_I',
				hrd_registration_class: 'OPTIONAL',
				hrd_form2_count: 8,
				hrd_optional_last_high_year: 2026,
				hrd_education_schedule_code: 'NONE'
			},
			effective_range: range('2026-09-01', null),
			approval_id: null
		}
	] as never;
	for (const [period, expected] of [
		['2026-08', 15],
		['2026-09', 30],
		['2026-12', 30],
		['2027-01', 15]
	] as const) {
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		assert.equal(
			slip.statutory.find((row) => row.scheme_code === 'HRDF')?.employer_amount,
			expected,
			period
		);
	}
});

// The revision write's refusals (declared keys, valid values): `entity-facts.test.ts`.
