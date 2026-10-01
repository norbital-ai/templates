import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatutoryWorld, COMPANY_ID, leaveCatalogue } from './fixtures/statutory-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { memoryDb } from './helpers/ctx.ts';
import { readLeaveContext, personAt } from '../src/lib/leave/context.ts';
import { planLeaveActivity, type LeaveSubmission } from '../src/lib/leave/activity.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/lib/payroll/run/engine.ts';

const id = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function maternityWorld(
	code: 'TW' | 'SG' | 'VN',
	person: Parameters<typeof createStatutoryWorld>[0]['people'][number]
) {
	const world = createStatutoryWorld({
		code,
		period: '2026-06',
		people: [person],
		riskClass: '1',
		region: code === 'VN' ? 'I' : null
	});
	world.leave_catalogue.push(...leaveCatalogue(code).map((row) => ({ ...row, approval_id: null })));
	return { ...world, company_facts: [] as NonNullable<typeof world.company_facts> };
}

/** The actual approval planner, followed by a database-shaped read into the payroll gather. */
async function approve(
	world: ReturnType<typeof maternityWorld>,
	fields: Partial<LeaveSubmission>,
	number = 1
) {
	const employmentId = String(world.employments[0]!.id);
	const context = await readLeaveContext(
		memoryDb(world) as never,
		[employmentId],
		{ start: '2026-06-01', end: '2026-06-30' },
		true
	);
	const settings = context.versions.find(
		(row) =>
			String(row.effective_range?.start).slice(0, 10) <= '2026-06-08' &&
			(row.effective_range?.end == null ||
				String(row.effective_range.end).slice(0, 10) >= '2026-06-08')
	)!;
	const catalogue = context.catalogues.find(
		(row) => row.settings_id === settings.id && row.code === 'MATERNITY_LEAVE'
	)!;
	const planned = planLeaveActivity(
		context,
		{
			employment_id: employmentId,
			catalogue_id: catalogue.id,
			reference: `BIRTH-${number}`,
			from_date: '2026-06-08',
			to_date: '2026-06-08',
			facts: {
				event_kind: 'BIRTH',
				event_date: '2026-06-08'
			},
			...fields
		},
		id(number)
	);
	const row = { id: id(number), ...planned, approval_id: null, payslip_id: null as string | null };
	world.leave_entries.push(row);
	return row;
}

function price(world: ReturnType<typeof maternityWorld>, period = '2026-06') {
	const prepared = gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period });
	const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
	return { prepared, slip };
}

// MOL's maternity FAQ: LSA-covered birth / >=3-month miscarriage pays half below six months'
// service, full from six months. Shorter pregnancies are unpaid. TWD 30,000 / 30 = 1,000/day.
// https://www.mol.gov.tw/1607/28162/28166/28268/28270/29101/
for (const [kind, hire, deduction] of [
	['BIRTH', '2026-04-01', 500],
	['BIRTH', '2025-01-01', 0],
	['MISCARRIAGE_3M', '2026-04-01', 500],
	['MISCARRIAGE_2M', '2025-01-01', 1_000],
	['MISCARRIAGE_UNDER_2M', '2025-01-01', 1_000]
] as const) {
	test(`TW ${kind}, service from ${hire}: approval facts survive payroll and reversal`, async () => {
		const world = maternityWorld('TW', {
			key: 'MOTHER',
			wage: 30_000,
			gender: 'FEMALE',
			hire_date: hire
		});
		const original = await approve(world, {
			facts: { event_kind: kind, event_date: '2026-06-08' }
		});
		const { prepared, slip } = price(world);
		assert.equal(prepared.gathered.bundles[0]!.leave.entries[0]!.facts?.event_kind, kind);
		assert.equal(
			slip.adjustments.find((line) => line.component_code === 'MATERNITY_LEAVE')?.amount ?? 0,
			deduction
		);
		assert.equal(slip.gross, 30_000 - deduction);
		await approve(
			world,
			{
				from_date: null,
				to_date: null,
				as_adjustment_entry: true,
				reversal_of_id: original.id,
				effective_on: '2026-06-09',
				reason: 'Corrected event',
				facts: {
					event_kind: null,
					event_date: null
				}
			},
			2
		);
		const corrected = price(world).slip;
		assert.equal(corrected.gross, 30_000);
		assert.equal(corrected.adjustments.filter((line) => line.family === 'LEAVE').length, 0);
	});
}

// MOM: a non-citizen third child has no statutory paid maternity segment; a Singapore citizen
// child qualifies for GPML with the same mother's >=3 months' service.
// https://www.mom.gov.sg/employment-practices/leave/maternity-leave/eligibility-and-entitlement
for (const citizenship of ['CITIZEN', 'FOREIGNER']) {
	test(`SG selected third child (${citizenship}) controls maternity pay`, async () => {
		const world = maternityWorld('SG', {
			key: 'MOTHER',
			wage: 2_200,
			gender: 'FEMALE',
			child_rows: [
				{ child_birthdate: '2020-01-01', citizenship: 'CITIZEN' },
				{ child_birthdate: '2022-01-01', citizenship: 'CITIZEN' },
				{ child_birthdate: '2026-06-08', citizenship }
			]
		});
		await approve(world, {
			facts: { event_kind: 'BIRTH', event_date: '2026-06-08', event_child_index: 3 }
		});
		const { prepared, slip } = price(world);
		assert.equal(prepared.gathered.bundles[0]!.leave.entries[0]!.facts?.event_child_index, 3);
		assert.equal(
			slip.adjustments.find((line) => line.component_code === 'MATERNITY_LEAVE')?.amount ?? 0,
			citizenship === 'CITIZEN' ? 0 : 100
		);
		assert.equal(
			slip.statutory.find((line) => line.scheme_code === 'CPF')?.base_amount,
			citizenship === 'CITIZEN' ? 2_200 : 2_100
		);
	});
}

test('VN birth event reduces employer wages for a fund-paid working day', async () => {
	const world = maternityWorld('VN', {
		key: 'MOTHER',
		wage: 22_000_000,
		gender: 'FEMALE',
		registrations: {
			SI: {
				kind: 'REGISTERED',
				elections: {
					maternity_benefit_eligible: true,
					maternity_category: 'BIRTH',
					maternity_returned_early: false
				}
			}
		}
	});
	await approve(world, {});
	const { slip } = price(world);
	// This fixture has 22 normal working days in June: one is paid by social insurance.
	assert.equal(
		slip.adjustments.find((line) => line.component_code === 'MATERNITY_LEAVE')?.amount,
		1_000_000
	);
	assert.equal(slip.gross, 21_000_000);
});

for (const filtered of ['expired', 'not-born'] as const) {
	test(`SG stored child index survives an earlier ${filtered} child record`, async () => {
		const world = maternityWorld('SG', {
			key: 'MOTHER',
			wage: 2_200,
			gender: 'FEMALE',
			child_rows: [
				{
					child_birthdate: filtered === 'expired' ? '2010-01-01' : '2027-01-01',
					citizenship: 'FOREIGNER'
				},
				{ child_birthdate: '2020-01-01', citizenship: 'CITIZEN' },
				{ child_birthdate: '2022-01-01', citizenship: 'CITIZEN' },
				{ child_birthdate: '2026-06-08', citizenship: 'CITIZEN' }
			]
		});
		if (filtered === 'expired') {
			const children = world.employees[0]!.children as Array<{ effective_range: unknown }>;
			children[0]!.effective_range = { start: '2010-01-01', end: '2025-12-31' };
		}
		await approve(world, {
			facts: { event_kind: 'BIRTH', event_date: '2026-06-08', event_child_index: 4 }
		});
		assert.equal(price(world).slip.gross, 2_200);
	});
}

test('a paid TW half-pay correction restores the frozen deduction in the following run', async () => {
	const world = maternityWorld('TW', {
		key: 'MOTHER',
		wage: 30_000,
		gender: 'FEMALE',
		hire_date: '2026-04-01'
	});
	const originalTerms = world.employment_terms[0]!;
	const originalRange = originalTerms.effective_range as { start: string; end: string | null };
	originalTerms.effective_range = { ...originalRange, end: '2026-06-30' };
	world.employment_terms.push({
		...originalTerms,
		id: id(200),
		effective_range: { start: '2026-07-01', end: null },
		base_salary: 36_000,
		currency: 'TWD'
	});
	const original = await approve(world, {});
	const { slip } = price(world);
	assert.equal(slip.gross, 29_500);
	world.payroll_runs.push({
		id: id(100),
		company_id: COMPANY_ID,
		period: '2026-06',
		attendance_from: '2026-06-01',
		attendance_to: '2026-06-30',
		approval_id: null
	});
	world.payslips.push({
		...slip,
		id: id(101),
		payroll_run_id: id(100),
		paid_at: '2026-06-30',
		approval_id: null
	});
	original.payslip_id = id(101);
	await approve(
		world,
		{
			from_date: null,
			to_date: null,
			as_adjustment_entry: true,
			reversal_of_id: original.id,
			effective_on: '2026-07-01',
			due_on: '2026-07-01',
			reason: 'Correct paid leave',
			facts: {
				event_kind: null,
				event_date: null
			}
		},
		2
	);
	// A correction must use the frozen 500, even after the person's current monthly salary changes.
	const corrected = price(world, '2026-07').slip;
	const refund = corrected.adjustments.find((line) => line.family === 'LEAVE')!;
	assert.equal(refund.bucket, 'ABSENCE');
	assert.equal(refund.amount, -500);
	assert.equal(corrected.gross, 36_500);
});

test('payroll reads event relationship, personal registration and company revisions on each charged day', async () => {
	const world = maternityWorld('TW', { key: 'MOTHER', wage: 30_000, gender: 'FEMALE' });
	// A contractual test rule isolates the context transport; this is not a claimed statutory pay scale.
	for (const catalogue of world.leave_catalogue) {
		if (catalogue.code === 'MATERNITY_LEAVE')
			catalogue.pay_fraction =
				'event.relationship == "SELF" && facts.LI.registered && company.facts.overtime_consent ? 0.5 : 0.25';
	}
	const companyFacts = world.company_facts!;
	companyFacts.push(
		{
			company_id: COMPANY_ID,
			facts: { overtime_consent: true },
			effective_range: { start: '2026-06-01', end: '2026-06-09' },
			approval_id: null
		},
		{
			company_id: COMPANY_ID,
			facts: { overtime_consent: false },
			effective_range: { start: '2026-06-10', end: null },
			approval_id: null
		}
	);
	const schemeIds = new Set(
		world.statutory_contributions.filter((row) => row.code === 'LI').map((row) => row.id)
	);
	assert.ok(schemeIds.size > 0);
	for (const [index, fact] of [...world.employment_statutory_facts].entries()) {
		if (!schemeIds.has(fact.statutory_contribution_id)) continue;
		fact.effective_range = { start: '2015-01-01', end: '2026-06-08' };
		world.employment_statutory_facts.push(
			{
				...fact,
				id: id(200 + index * 2),
				effective_range: { start: '2026-06-09', end: '2026-06-09' },
				status: { kind: 'NOT_REGISTERED' }
			},
			{ ...fact, id: id(201 + index * 2), effective_range: { start: '2026-06-10', end: null } }
		);
	}
	await approve(world, {
		to_date: '2026-06-10',
		facts: { event_kind: 'BIRTH', event_date: '2026-06-08', event_relationship: 'SELF' }
	});
	const { prepared, slip } = price(world);
	assert.deepEqual(
		Object.values(prepared.gathered.bundles[0]!.leave.deductionShare!),
		[0.5, 0.75, 0.75]
	);
	assert.equal(slip.gross, 28_000);
});

test('historical leave uses the declaration definition of its own settings version', async () => {
	const world = maternityWorld('TW', { key: 'MOTHER', wage: 30_000, gender: 'FEMALE' });
	// Contractual defaults deliberately differ between versions, isolating historical schema selection.
	for (const scheme of world.statutory_contributions) {
		if (scheme.code !== 'LI') continue;
		const settings = world.jurisdiction_settings.find((row) => row.id === scheme.settings_id)!;
		const start = (settings.effective_range as { start: string }).start;
		scheme.elections = [
			...(scheme.elections as readonly { key: string }[]),
			{
				key: 'transport_pay_fraction',
				type: 'number',
				label: 'Contractual fraction',
				default_value: start.slice(0, 4) < '2026' ? 0.25 : 0.5
			}
		];
	}
	for (const catalogue of world.leave_catalogue) {
		if (catalogue.code === 'MATERNITY_LEAVE')
			catalogue.pay_fraction = 'facts.LI.elections.transport_pay_fraction';
	}
	await approve(world, {
		from_date: '2025-12-08',
		to_date: '2025-12-08',
		event_date: '2025-12-08'
	});
	await approve(world, {}, 2);
	const employmentId = String(world.employments[0]!.id);
	const approvalContext = await readLeaveContext(memoryDb(world) as never, [employmentId]);
	assert.equal(
		personAt(approvalContext, employmentId, '2025-12-08').facts.LI!.elections
			.transport_pay_fraction,
		0.25
	);
	assert.equal(
		personAt(approvalContext, employmentId, '2026-06-08').facts.LI!.elections
			.transport_pay_fraction,
		0.5
	);
	const { prepared, slip } = price(world);
	assert.equal(prepared.gathered.bundles[0]!.leave.deductionShare![`${id(1)}/2025-12-08`], 0.75);
	assert.equal(prepared.gathered.bundles[0]!.leave.deductionShare![`${id(2)}/2026-06-08`], 0.5);
	assert.equal(slip.gross, 29_500);
});
