import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { inForce } from '../../../../../lib/dated.js';
import type { Reader } from '../../../../../lib/reads.js';
import { jsonObject } from '../../../../../lib/foundation.js';
import { termsChange } from '../../../employee_profile/service/person.js';
import { sheetsOf, workbookOf } from './salary_listing_export.js';
import { collectPages, downloadWorkbook } from './xlsx_sheet.js';

/**
 * Every selected run's listing, read for the whole selection in two dependency waves, following every page: the runs with their payslips, each with its
 * stint as it stood at the period's end, then those people's stints, which say who has left.
 */
export const listingRead = Effect.fn('payroll.listingRead')(function* (
	read: Reader | PageContext['query'],
	ids: readonly Id<'payroll_run'>[]
) {
	const runQuery = {
		where: { id: { in: [...ids] } },
		fields: ['period', 'kind', 'entity_id', 'salary_coverage'],
		limit: 1000,
		entity_id: { fields: ['name', 'settings_code'] }
	} as const;
	const lawQuery = { fields: ['code', 'currency'], limit: 1000 } as const;
	const slipQuery = {
		where: { payroll_run_id: { in: [...ids] } },
		fields: [
			'payroll_run_id',
			'employee_id',
			'employment_id',
			'gross_earnings',
			'net_pay',
			'tax_withheld',
			'employee_statutory',
			'employer_cost',
			'breakdown'
		],
		limit: 100,
		employment_id: {
			fields: ['employee_number', 'employee_id', 'service_started_on'],
			employee_id: { fields: ['name', 'identity_number'] },
			terms: { fields: ['effective_from', 'clears', 'job_title', 'department'] }
		}
	} as const;
	const first = yield* read({ payroll_run: runQuery, payslip: slipQuery, jurisdiction: lawQuery });
	const runs = yield* collectPages(first.payroll_run, (after) =>
		read({ payroll_run: { ...runQuery, after } }).pipe(Effect.map((p) => p.payroll_run))
	);
	const slips = yield* collectPages(first.payslip, (after) =>
		read({ payslip: { ...slipQuery, after } }).pipe(Effect.map((p) => p.payslip))
	);
	const laws = yield* collectPages(first.jurisdiction, (after) =>
		read({ jurisdiction: { ...lawQuery, after } }).pipe(Effect.map((p) => p.jurisdiction))
	);
	if (runs.length !== new Set(ids).size)
		return yield* Effect.fail(
			new Error(
				'Some selected payroll runs could not be read; the salary listing was not exported.'
			)
		);
	const stintQuery = {
		where: { employee_id: { in: [...new Set(slips.map((slip) => slip.employee_id))] } },
		fields: ['employee_id', 'effective_range'],
		limit: 1000
	} as const;
	const stintPage = (yield* read({ employment: stintQuery })).employment;
	const stints = yield* collectPages(stintPage, (after) =>
		read({ employment: { ...stintQuery, after } }).pipe(Effect.map((p) => p.employment))
	);
	const closes = new Map(runs.map((run) => [run.id, run.salary_coverage.to ?? '']));
	// a run is paid in the currency of its company's jurisdiction
	const currency = new Map(laws.map((row) => [row.code, row.currency]));
	return {
		runs: runs.map((run) => ({
			...run,
			currency: currency.get(run.entity_id?.settings_code ?? '')
		})),
		slips: slips.map((slip) => {
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
		stints
	};
});

/** Reads the selected runs and downloads their salary listing: one workbook, a sheet each. */
export const exportSalaryListing = (
	ctx: Pick<PageContext, 'query'>,
	ids: readonly Id<'payroll_run'>[]
) =>
	listingRead(ctx.query, ids).pipe(
		Effect.flatMap((read) =>
			Effect.try({
				try: () => sheetsOf(read),
				catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
			})
		),
		Effect.flatMap((sheets) =>
			Effect.tryPromise({
				try: async () => {
					const first = sheets[0];
					if (first === undefined) return;
					const last = sheets.at(-1);
					await downloadWorkbook(
						workbookOf(sheets),
						`Salary listing ${first.company} ${first.period}${
							last === first ? '' : ` to ${last?.period ?? ''}`
						}.xlsx`
					);
				},
				catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
			})
		)
	);
