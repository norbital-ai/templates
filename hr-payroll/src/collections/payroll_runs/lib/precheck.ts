/**
 * What has to be true *before* a payroll run record exists.
 *
 * The split this file exists for is a platform semantic, not a payroll one. A `before` hook runs
 * ahead of the write and can refuse it: nothing is inserted, so there is nothing to undo. An `after`
 * hook runs once the row is a fact, and the database facility has no transaction primitive — every
 * statement is its own autocommitted call — so an `after` that throws cannot take the row back with
 * it. It never could; the difference is that the runtime now says so.
 *
 * That is what produced the orphaned draft. The whole engine ran in `create.after`: the run row was
 * committed, the build then refused because somebody had an unclosed clock, and what was left was a
 * DRAFT payroll run with no payslips under it — a record that says a period has been calculated,
 * sitting in the list, blocking the next period, describing a calculation that never happened.
 *
 * So the checks that can refuse a run on facts knowable before it is built move here, and the engine
 * keeps its own copies. That duplication is deliberate: these two run at different moments, and the
 * gap between them is real. A clock opened after this passes and before the build reaches it must
 * still stop the build — the engine's checks are what make the payslips right, and these are what
 * keep a refusal from leaving a record behind.
 */

import { Effect } from 'effect';
import { PAGE_LIMIT, type PayrollReadApi, withReadLog } from './api.js';
import type { Configuration } from './configuration.js';
import type { PayrollWindow } from './period.js';
import {
	blockers,
	validateConfiguration,
	validateOpenWorkDays,
	type RunIssue
} from './validate.js';

/**
 * Every blocking issue this run can be refused on without building it.
 *
 * Deliberately not "run the engine and see". The engine gathers a month of attendance, leave, terms
 * and statutory standing for every employment in the company, which is the expensive half of a
 * payroll run and not something to do twice. These are the two checks whose inputs are cheap to
 * read and whose verdicts do not change once the run exists:
 *
 * - **the configuration**, which `preparePayrollRun` has already resolved by the time this is
 *   called, so it costs nothing at all;
 * - **open clocks**, read directly over the attendance window rather than out of a gathered
 *   bundle. This is the one that was actually refusing builds and leaving drafts behind.
 *
 * Everything else the engine validates — overtime ceilings, daily work limits, pay-calendar cadences
 * — needs per-employment measurement to know, and stays where the measurement is.
 */
export function payrollRunPrecheck(options: {
	readonly api: PayrollReadApi;
	readonly configuration: Configuration;
	readonly window: PayrollWindow;
}): Effect.Effect<RunIssue[], never, never> {
	return Effect.gen(function* () {
		const api = withReadLog(options.api);
		const issues: RunIssue[] = validateConfiguration(options.configuration);
		const db = api.db;
		const approved = { approval_id: { isNull: true } } as const;
		// The same ceiling and the same truncation guard the build reads under. A precheck that could
		// silently see a shorter page than the engine would admit exactly the run the engine then
		// refuses, which is the state this whole file exists to prevent.
		const employments = api.reads.assertComplete(
			yield* db.employments.findMany({
				where: {
					company_id: { eq: options.configuration.company.id },
					...approved
				},
				limit: PAGE_LIMIT
			}),
			'precheck employments'
		);
		const employmentIds = employments.map((row) => row.id);
		if (employmentIds.length > 0) {
			const workDays = api.reads.assertComplete(
				yield* db.work_days.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: {
							gte: options.window.attendance.start,
							lte: options.window.attendance.end
						},
						...approved
					},
					limit: PAGE_LIMIT
				}),
				'precheck work days'
			);
			// Re-shaped into the bundles `validateOpenWorkDays` reads, rather than reimplementing what
			// an unclosed interval is. The rule and its sentence live in one place, and this is only a
			// second way of reaching it — a second implementation would be a second chance to disagree
			// with the build about what "open" means, and disagreeing here would refuse runs the
			// engine would have accepted.
			const byEmployment = new Map<string, (typeof workDays)[number][]>();
			for (const day of workDays) {
				const existing = byEmployment.get(day.employment_id);
				if (existing === undefined) byEmployment.set(day.employment_id, [day]);
				else existing.push(day);
			}
			issues.push(
				...validateOpenWorkDays({
					bundles: employments.map((employment) => ({
						employment: { employee_number: employment.employee_number },
						workDays: byEmployment.get(employment.id) ?? []
					}))
				})
			);
		}
		return blockers(issues);
	});
}
