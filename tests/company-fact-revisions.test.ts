import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	COMPANY_ID,
	createStatutoryWorld,
	type StatutoryBook
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { resolveCompanyFacts } from '../src/lib/declared-facts.ts';
import revisions from '../src/collections/company_facts/+collection.ts';
import { transformOne } from './helpers/transform.ts';

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
		const prepared = Effect.runSync(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
		);
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		return slip.statutory.find((row) => row.scheme_code === 'SI')!.employer_amount;
	};
	// 17.5% + 0.5% occupational accident before the revision, 0.3% once it is in force.
	assert.equal(employerSi('2026-01'), 1_750_000);
	assert.equal(employerSi('2026-02'), 1_730_000);
});

test('a revision cannot declare a key its lineage does not', () => {
	const company = { id: 'c1', settings_code: 'SG' };
	const version = {
		id: 'v1',
		code: 'SG',
		facts: [{ key: 'sector', type: 'string' }],
		sealed_at: '2026-01-01T00:00:00.000Z',
		voided_at: null,
		approval_id: null
	};
	const db = {
		companies: { findMany: () => Effect.succeed([company]) },
		jurisdiction_settings: { findMany: () => Effect.succeed([version]) }
	};
	const saved = transformOne(
		revisions,
		{
			company_id: 'c1',
			facts: { sector: 'manufacturing' },
			effective_range: range('2026-01-01', null)
		},
		undefined,
		db
	);
	assert.deepEqual(saved.facts, { sector: 'manufacturing' });
	assert.throws(
		() =>
			transformOne(
				revisions,
				{
					company_id: 'c1',
					facts: { overtime_consent: true },
					effective_range: range('2026-01-01', null)
				},
				undefined,
				db
			),
		/does not declare the entity fact overtime_consent/
	);
});

export type { StatutoryBook };
