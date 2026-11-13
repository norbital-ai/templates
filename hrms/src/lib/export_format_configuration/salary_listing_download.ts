import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { inForce } from '../dated.js';
import { jsonObject } from '../payroll_engine/foundation.js';
import { termsChange } from '../person.js';
import { sheetsOf, workbookOf } from './salary_listing_export.js';

/**
 * Every selected run's listing, read for the whole selection in two waves: the runs with their payslips, each with its
 * stint as it stood at the period's end, then those people's stints, which say who has left.
 */
const listingRead = Effect.fn('payroll.listingRead')(function* (
	ctx: Pick<PageContext, 'query'>,
	ids: readonly Id<'payroll_run'>[]
) {
	const {
		payroll_run: runs,
		payslip: slips,
		jurisdiction: laws
	} = yield* ctx.query({
		payroll_run: {
			where: { id: { in: [...ids] } },
			fields: ['period', 'kind', 'entity_id', 'salary_coverage'],
			limit: 1000,
			entity_id: { fields: ['name', 'settings_code'] }
		},
		jurisdiction: { fields: ['code', 'currency'], limit: 1000 },
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
				fields: ['employee_number', 'employee_id', 'service_started_on'],
				employee_id: { fields: ['name', 'identity_number'] },
				terms: { fields: ['effective_from', 'clears', 'job_title', 'department'] }
			}
		}
	});
	const { employment: stints } = yield* ctx.query({
		employment: {
			where: { employee_id: { in: [...new Set(slips.rows.map((slip) => slip.employee_id))] } },
			fields: ['employee_id', 'effective_range'],
			limit: 10000
		}
	});
	const closes = new Map(runs.rows.map((run) => [run.id, String(run.salary_coverage.to ?? '')]));
	// a run is paid in the currency of its company's jurisdiction
	const currency = new Map(laws.rows.map((row) => [row.code, row.currency]));
	return {
		runs: runs.rows.map((run) => ({
			...run,
			currency: currency.get(run.entity_id?.settings_code ?? '')
		})),
		slips: slips.rows.map((slip) => {
			const stint = slip.employment_id;
			if (stint == null) return { ...slip, employment_id: null };
			const agreed = inForce(
				stint.terms.map((row) => termsChange(jsonObject(row))),
				closes.get(slip.payroll_run_id) ?? ''
			).state;
			return {
				...slip,
				employment_id: {
					employee_number: stint.employee_number,
					employee_id: stint.employee_id,
					service_started_on: stint.service_started_on,
					terms: { job_title: agreed.job_title, department: agreed.department },
					payroll: { identity_number: stint.employee_id?.identity_number }
				}
			};
		}),
		stints: stints.rows
	};
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
