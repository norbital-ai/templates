import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { sheetsOf, workbookOf } from './salary_listing_export.js';

/**
 * Every selected run's listing, read for the whole selection in two waves: the runs with their payslips and contracts,
 * then those people's contract versions, which say who has left.
 */
const listingRead = Effect.fn('payroll.listingRead')(function* (
	ctx: Pick<PageContext, 'query'>,
	ids: readonly Id<'payroll_run'>[]
) {
	const { payroll_run: runs, payslip: slips } = yield* ctx.query({
		payroll_run: {
			where: { id: { in: [...ids] } },
			fields: ['period', 'kind', 'entity_id', 'settings_id'],
			limit: 1000,
			entity_id: { fields: ['name'] },
			settings_id: { fields: ['currency'] }
		},
		payslip: {
			where: { payroll_run_id: { in: [...ids] } },
			fields: [
				'payroll_run_id',
				'employee_id',
				'employment_id',
				'gross_earnings',
				'net_pay',
				'tax_withheld',
				'breakdown'
			],
			limit: 10000,
			employment_id: {
				fields: [
					'employee_number',
					'employee_id',
					'terms',
					'payroll',
					'service_started_on',
					'effective_range'
				],
				employee_id: { fields: ['name'] }
			}
		}
	});
	const { employee_contract: versions } = yield* ctx.query({
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
export const exportSalaryListing = (
	ctx: Pick<PageContext, 'query'>,
	ids: readonly Id<'payroll_run'>[]
) =>
	listingRead(ctx, ids).pipe(
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
