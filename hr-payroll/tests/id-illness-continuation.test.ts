import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPANY_ID, createStatutoryWorld, leaveCatalogue } from './fixtures/statutory-world.ts';
import { memoryDb } from './helpers/ctx.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { readLeaveContext } from '../src/lib/leave/context.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';

// UU 13/2003 art.93(3), signed primary text p.32:
// https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf
// A continuation must retain its original four-month stage, even across settings revisions.
// Removing the medical catalogue's event_date declaration must fail these payroll assertions.
for (const [date, month, fraction, deduction] of [
	['2026-03-02', 4, 1, 0],
	['2026-04-01', 5, 0.75, 250_000],
	['2026-07-01', 8, 0.75, 250_000],
	['2026-08-03', 9, 0.5, 500_000],
	['2026-11-02', 12, 0.5, 500_000],
	['2026-12-01', 13, 0.25, 750_000]
] as const) {
	test(`ID art.93(3): split continuous illness month ${month} pays ${fraction * 100}%`, async () => {
		const period = date.slice(0, 7);
		const days = new Date(
			Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)
		).getUTCDate();
		// Calendar-day proration is the configured owner default; choose a Rp1m daily wage.
		const wage = days * 1_000_000;
		const world = createStatutoryWorld({
			code: 'ID',
			period,
			region: 'Provinsi DKI Jakarta',
			riskClass: 'I',
			people: [{ key: 'ILL', wage, hire_date: '2025-12-01' }]
		});
		world.leave_catalogue.push(
			...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null }))
		);
		const employmentId = String(world.employments[0]!.id);
		for (const [index, day] of ['2025-12-01', date].entries()) {
			const context = await readLeaveContext(
				memoryDb(world) as never,
				[employmentId],
				{ start: day, end: day },
				true
			);
			const settings = context.versions.find(
				(row) =>
					String(row.effective_range?.start).slice(0, 10) <= day &&
					(row.effective_range?.end == null || String(row.effective_range.end).slice(0, 10) > day)
			)!;
			const catalogue = context.catalogues.find(
				(row) => row.settings_id === settings.id && row.code === 'MEDICAL_LEAVE'
			)!;
			const id = `a3700000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
			const planned = planLeaveActivity(
				context,
				{
					employment_id: employmentId,
					catalogue_id: catalogue.id,
					reference: `ILL-${index}`,
					from_date: day,
					to_date: day,
					facts: { event_date: '2025-12-01' }
				},
				id
			);
			world.leave_entries.push({
				id,
				...planned,
				certificate_file: { name: 'doctor.pdf', url: '/doctor.pdf' },
				approval_id: null,
				payslip_id: null
			});
		}
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		assert.equal(
			prepared.gathered.bundles[0]!.leave.deductionShare![
				`a3700000-0000-4000-8000-000000000002/${date}`
			],
			1 - fraction
		);
		assert.equal(
			slip.adjustments.find((row) => row.component_code === 'MEDICAL_LEAVE')?.amount ?? 0,
			deduction
		);
		assert.equal(slip.gross, wage - deduction);
	});
}
