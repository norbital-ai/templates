import { Effect } from 'effect';
import { bolt } from '$bolt';
import type { Id } from '@norbital-ai/bolt';
import { sheetsOf, workbookOf } from './salary_listing_export.js';

/**
 * Every selected run's listing, read for the whole selection in two waves: the runs with their payslips and contracts,
 * then those people's contract versions, which say who has left.
 */
const listingRead = Effect.fn('payroll.listingRead')(function* (ids: readonly Id<'payroll_run'>[]) {
	const { payroll_run: runs, payslip: slips } = yield* bolt.query({
		payroll_run: {
			where: { id: { in: [...ids] } },
			fields: ['period', 'kind', 'entity_id', 'settings_id'],
			limit: 1000
		},
		'payroll_run.entity_id': { fields: ['name'] },
		'payroll_run.settings_id': { fields: ['currency'] },
		payslip: {
			where: { payroll_run_id: { in: [...ids] } },
			fields: [
				'payroll_run_id',
				'employee_id',
				'employment_id',
				'gross_earnings',
				'net_pay',
				'breakdown'
			],
			limit: 10000
		},
		'payslip.employment_id': {
			fields: [
				'employee_number',
				'employee_name',
				'terms',
				'payroll',
				'service_started_on',
				'effective_range'
			]
		}
	});
	const { employee_contract: versions } = yield* bolt.query({
		employee_contract: {
			where: {
				employee_id: { in: [...new Set(slips.rows.map((slip) => slip.employee_id))] },
				status: { eq: 'SEALED' }
			},
			fields: ['employee_id', 'effective_range'],
			limit: 10000
		}
	});
	return { runs: runs.rows, slips: slips.rows, versions: versions.rows };
});

/** Reads the selected runs and downloads their salary listing: one workbook, a sheet each. */
export const exportSalaryListing = (ids: readonly Id<'payroll_run'>[]) =>
	listingRead(ids).pipe(
		Effect.map(sheetsOf),
		Effect.flatMap((sheets) =>
			Effect.promise(async () => {
				if (sheets.length === 0) return;
				const bytes = await workbookOf(sheets).xlsx.writeBuffer();
				const url = URL.createObjectURL(
					new Blob([new Uint8Array(bytes)], {
						type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
					})
				);
				const first = sheets[0];
				const last = sheets.at(-1);
				const link = Object.assign(document.createElement('a'), {
					href: url,
					download: `Salary listing ${first?.company ?? ''} ${first?.period ?? ''}${
						last === first ? '' : ` to ${last?.period ?? ''}`
					}.xlsx`
				});
				link.click();
				URL.revokeObjectURL(url);
			})
		)
	);
