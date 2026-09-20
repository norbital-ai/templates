import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, leaveCatalogue } from './fixtures/statutory-world.ts';

// DOLE Handbook, Service Incentive Leave, Conversion: use the salary rate at
// conversion, including pro-rata leave. A daily contract already states that rate;
// an hourly contract needs the reference pattern's normal hours for one workday.
// https://nwpc.dole.gov.ph/wp-content/uploads/2023/08/2023-07-25-Handbook-on-Workers-Statutory-Monetary-Benefits-2023_edition.pdf
for (const period of ['2025-12', '2026-01', '2026-04', '2026-10']) {
	for (const frequency of ['DAILY', 'HOURLY'] as const) {
		test(`PH ${period}: ${frequency} SIL conversion pays 1.5 days at the conversion-date wage`, () => {
			const { slips } = buildStatutory(
				{
					code: 'PH',
					period,
					people: [
						{ key: 'SIL', wage: frequency === 'DAILY' ? 800 : 100, pay_frequency: frequency }
					]
				},
				(world) => {
					const current = world.employment_terms[0]!;
					world.employment_terms.push({
						...current,
						id: 'f2000000-0000-4000-8000-000000000001',
						base_salary: { ...current.base_salary, value: frequency === 'DAILY' ? 600 : 75 },
						effective_range: { start: '2015-01-01', end: `${period}-10` }
					});
					current.effective_range = { start: `${period}-10`, end: null };
					const version = world.jurisdiction_settings.find(
						(row) =>
							String(row.effective_range.start).slice(0, 10) <= `${period}-05` &&
							String(row.effective_range.end).slice(0, 10) > `${period}-05`
					)!;
					world.leave_catalogue.push(
						...leaveCatalogue('PH').map((row) => ({ ...row, approval_id: null }))
					);
					const catalogue = world.leave_catalogue.find(
						(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
					)!;
					world.leave_entries.push({
						id: 'f2000000-0000-4000-8000-000000000002',
						employment_id: world.employments[0]!.id,
						catalogue_id: catalogue.id,
						leave_code: catalogue.code,
						reference: 'SIL-CONVERSION',
						from_date: `${period.slice(0, 4)}-01-01`,
						to_date: `${period.slice(0, 4)}-12-31`,
						days: 1.5,
						encash_days: 1.5,
						effective_on: `${period}-05`,
						due_on: `${period}-20`,
						charges: [],
						allocations: [],
						approval_id: null,
						payslip_id: null,
						as_adjustment_entry: false
					} as never);
				}
			);
			const line = slips
				.get('SIL')!
				.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT');
			assert.equal(line?.amount, 900);
		});
	}
}
