import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPANY_ID, createStatutoryWorld, leaveCatalogue } from './fixtures/statutory-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { memoryDb } from './helpers/ctx.ts';
import { readLeaveContext } from '../src/lib/leave/context.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/lib/payroll/run/engine.ts';

test('PH maternity leave approval and payroll do not depend on SSS registration age', async () => {
	for (const sssKind of ['REGISTERED', 'NOT_REGISTERED'] as const) {
		const world = createStatutoryWorld({
			code: 'PH',
			period: '2026-10',
			region: 'NCR',
			people: [
				{
					key: 'MOTHER',
					wage: 20_000,
					gender: 'FEMALE',
					hire_date: '2026-09-01',
					registrations: {
						SSS: { kind: sssKind, first_contribution_due_on: '2026-09-01' }
					}
				}
			]
		});
		world.leave_catalogue.push(
			...leaveCatalogue('PH').map((row) => ({ ...row, approval_id: null }))
		);
		const employmentId = String(world.employments[0]!.id);
		const context = await readLeaveContext(
			memoryDb(world) as never,
			[employmentId],
			{ start: '2026-10-05', end: '2026-10-05' },
			true
		);
		const settings = context.versions.find(
			(row) =>
				String(row.effective_range.start) <= '2026-10-05' &&
				(row.effective_range.end == null || String(row.effective_range.end) > '2026-10-05')
		)!;
		const catalogue = context.catalogues.find(
			(row) => row.settings_id === settings.id && row.code === 'MATERNITY_LEAVE'
		)!;
		const planned = planLeaveActivity(
			context,
			{
				employment_id: employmentId,
				catalogue_id: catalogue.id,
				reference: `BIRTH-${sssKind}`,
				from_date: '2026-10-05',
				to_date: '2026-10-05',
				event_kind: 'BIRTH',
				event_date: '2026-10-05'
			},
			'a2000000-0000-4000-8000-000000009001'
		);
		assert.equal(planned.days, 1);
		assert.equal(planned.charges.length, 1);
		world.leave_entries.push({
			id: 'a2000000-0000-4000-8000-000000009001',
			...planned,
			approval_id: null,
			payslip_id: null
		});
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period: '2026-10'
		});
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		assert.equal(prepared.gathered.bundles[0]!.leave.entries[0]!.event_kind, 'BIRTH');
		assert.equal(
			slip.adjustments.find((line) => line.component_code === 'MATERNITY_LEAVE')?.amount ?? 0,
			0
		);
		assert.equal(slip.gross, 20_000);
	}
});

test('PH 105-day maternity span charges every calendar day across weekends', async () => {
	const maternityRows = leaveCatalogue('PH').filter((row) => row.code === 'MATERNITY_LEAVE');
	assert.equal(maternityRows.length, 6);
	assert.ok(maternityRows.every((row) => row.entitlement.calendar_days === true));
	const world = createStatutoryWorld({
		code: 'PH',
		period: '2026-10',
		region: 'NCR',
		people: [{ key: 'MOTHER', wage: 20_000, gender: 'FEMALE' }]
	});
	world.leave_catalogue.push(...leaveCatalogue('PH').map((row) => ({ ...row, approval_id: null })));
	const employmentId = String(world.employments[0]!.id);
	const context = await readLeaveContext(
		memoryDb(world) as never,
		[employmentId],
		{ start: '2026-10-05', end: '2027-01-17' },
		true
	);
	const catalogue = context.catalogues.find(
		(row) => row.code === 'MATERNITY_LEAVE' && row.settings_id === context.versions.at(-1)?.id
	)!;
	assert.equal(catalogue.entitlement.calendar_days, true);
	const spans = [
		['2026-10-05', '2026-10-20'],
		['2026-10-21', '2026-11-20'],
		['2026-11-21', '2026-12-20'],
		['2026-12-21', '2027-01-17']
	] as const;
	let charged = 0;
	for (const [index, [from, to]] of spans.entries()) {
		const id = `a2000000-0000-4000-8000-${String(9002 + index).padStart(12, '0')}`;
		const planned = planLeaveActivity(
			context,
			{
				employment_id: employmentId,
				catalogue_id: catalogue.id,
				reference: `BIRTH-105-${index}`,
				from_date: from,
				to_date: to,
				event_kind: 'BIRTH',
				event_date: '2026-10-05'
			},
			id
		);
		charged += planned.charges.length;
		const row = { id, ...planned, approval_id: null, payslip_id: null };
		world.leave_entries.push(row);
		context.entries.push(row);
	}
	assert.equal(charged, 105);
	assert.ok(
		world.leave_entries.some((entry) =>
			entry.charges.some((charge) => charge.date === '2026-10-11')
		)
	);
	for (const [index, period] of ['2026-10', '2026-11', '2026-12', '2027-01'].entries()) {
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		const built = buildPayrollRun(prepared);
		const slip = built.payslip_payroll_run[0]!;
		assert.equal(slip.gross, 20_000, period);
		assert.deepEqual(
			built.captures[0]!.leave,
			[`a2000000-0000-4000-8000-${String(9002 + index).padStart(12, '0')}`],
			period
		);
	}
});

test('PH day 106 needs a birth-matched solo-parent case document, not the current employee flag', async () => {
	const world = createStatutoryWorld({
		code: 'PH',
		period: '2026-10',
		region: 'NCR',
		people: [{ key: 'MOTHER', wage: 20_000, gender: 'FEMALE', solo_parent: true }]
	});
	world.leave_catalogue.push(...leaveCatalogue('PH').map((row) => ({ ...row, approval_id: null })));
	const employmentId = String(world.employments[0]!.id);
	const context = await readLeaveContext(
		memoryDb(world) as never,
		[employmentId],
		{ start: '2026-10-05', end: '2027-02-01' },
		true
	);
	const catalogue = context.catalogues.find(
		(row) => row.code === 'MATERNITY_LEAVE' && row.settings_id === context.versions.at(-1)?.id
	)!;
	const request = (from_date: string, to_date: string) => ({
		employment_id: employmentId,
		catalogue_id: catalogue.id,
		reference: 'BIRTH-120',
		from_date,
		to_date,
		event_kind: 'BIRTH',
		event_date: '2026-10-05'
	});
	const first = planLeaveActivity(
		context,
		request('2026-10-05', '2027-01-17'),
		'a2000000-0000-4000-8000-000000009120'
	);
	context.entries.push({
		id: 'a2000000-0000-4000-8000-000000009120',
		...first,
		approval_id: null,
		payslip_id: null
	});
	// An extension is its own leave entry, so it carries its own reference: a second entry under the
	// first one's is refused as a duplicate.
	const extension = {
		...request('2027-01-18', '2027-02-01'),
		reference: 'BIRTH-120-EXT',
		event_relationship: 'CHILD'
	};
	assert.throws(
		() => planLeaveActivity(context, extension, 'a2000000-0000-4000-8000-000000009121'),
		/grants 105 days/
	);
	context.maternityCases = [
		{
			id: 'case',
			employment_id: employmentId,
			application_on: '2026-09-01',
			event_kind: 'BIRTH',
			event_on: '2026-10-05',
			solo_parent_claimed: true,
			solo_parent_document_kind: 'SOLO_PARENT_ID',
			solo_parent_document_issued_on: '2026-08-01',
			solo_parent_document_valid_from: '2026-08-01',
			solo_parent_document_valid_through: '2027-07-31',
			solo_parent_document_reference: 'LGU-SP-001',
			solo_parent_document_issuer_lgu: 'City LGU',
			solo_parent_document_file: { path: 'solo-parent-id.pdf' },
			solo_parent_social_worker_signature_seen: true,
			solo_parent_mayor_signature_seen: true
		} as never
	];
	assert.equal(
		planLeaveActivity(context, extension, 'a2000000-0000-4000-8000-000000009121').days,
		15
	);
	context.maternityCases = [{ ...context.maternityCases[0]!, event_on: '2026-10-06' }];
	assert.throws(
		() => planLeaveActivity(context, extension, 'a2000000-0000-4000-8000-000000009121'),
		/grants 105 days/
	);
});
