import assert from 'node:assert/strict';
import type { PayrollWorld } from './memory-payroll-api.ts';

/** Approved whole-day absences on a Monday–Friday fixture. */
export function addUnpaidWorkingDays(world: PayrollWorld, month: string, days: number): void {
	const catalogue = 'c1c1c1c1-0000-4000-8000-00000000000a';
	world.leave_catalogue.push({
		id: catalogue,
		settings_id: world.statutory_contributions.find((row) => row.code === 'SI')!.settings_id,
		code: 'UNPAID_LEAVE',
		name: 'Unpaid leave',
		eligibility: '',
		evidence: 'NONE',
		evidence_after_days: null,
		entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
		is_npl: true,
		can_encash: false,
		bands: [],
		approval_id: null
	});
	let remaining = days;
	for (let day = 1; day <= 31 && remaining > 0; day++) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const instant = new Date(`${date}T00:00:00Z`);
		if (instant.toISOString().slice(0, 7) !== month) break;
		if ([0, 6].includes(instant.getUTCDay())) continue;
		remaining--;
		world.leave_entries.push({
			id: `e1000000-0000-4000-8000-${String(day).padStart(12, '0')}`,
			employment_id: world.employments[0]!.id,
			catalogue_id: catalogue,
			leave_code: 'UNPAID_LEAVE',
			reference: `NPL-${day}`,
			from_date: date,
			to_date: date,
			half_day_start: false,
			half_day_end: false,
			days: 1,
			effective_on: date,
			reason: 'Unpaid day',
			allocations: [],
			charges: [
				{
					date,
					days: 1,
					catalogue_id: catalogue,
					employment_term_id: world.employment_terms[0]!.id,
					holiday_id: null,
					shift_definition_id: null,
					work_day_id: null
				}
			],
			approval_id: null,
			payslip_id: null
		});
	}
	assert.equal(remaining, 0, 'Fixture month has enough working days for the requested absence');
}
