import { resolveEmployment } from '../../../lib/employment-contract.js';
import { employmentDates, resolveEmploymentSettlement } from './settlement.js';
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
import { addDays, dateKey } from './dates.js';
import { cadenceWindow, employmentPayFrequency, paysOn, type PayrollWindow } from './period.js';
import { termPattern } from '../../../lib/scheduling/work-pattern.js';
import {
	blockers,
	rosteredWorkCodeMaps,
	validateConfiguration,
	validateOpenWorkDays,
	validateRosteredExpectations,
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
	/**
	 * The employments this run withholds. They are not checked, because they are not being paid —
	 * which is the whole point of a withhold: an unrostered person the operator has consciously left
	 * out must stop refusing the run for everybody else.
	 */
	readonly withheld?: readonly string[];
}): Effect.Effect<RunIssue[], never, never> {
	return Effect.gen(function* () {
		const api = withReadLog(options.api);
		const issues: RunIssue[] = validateConfiguration(options.configuration);
		const db = api.db;
		const approved = { approval_id: { isNull: true } } as const;
		// The same ceiling and the same truncation guard the build reads under. A precheck that could
		// silently see a shorter page than the engine would admit exactly the run the engine then
		// refuses, which is the state this whole file exists to prevent.
		const withheld = new Set(options.withheld ?? []);
		const employments = api.reads
			.assertComplete(
				yield* db.employments.findMany({
					where: {
						company_id: { eq: options.configuration.company.id },
						...approved
					},
					limit: PAGE_LIMIT
				}),
				'precheck employments'
			)
			.map(resolveEmployment)
			.filter((row) => !withheld.has(row.id));
		const employmentIds = employments.map((row) => row.id);
		if (employmentIds.length > 0) {
			/**
			 * The widest attendance window any employment settles over, not the company's.
			 *
			 * A leaver's final period runs to the exit date, past the company window's end, and
			 * `validateRosteredExpectations` measures the guarantee over that longer span. Reading
			 * only the company window here meant the tail was never loaded: the check demanded 34
			 * days of a leaver whose last week had not been read, and refused the whole company.
			 *
			 * The read is widened a day on each side because `work_date` is stored as an instant at
			 * the payroll timezone's midnight, not at UTC midnight — a bound typed as a plain
			 * calendar date would otherwise drop the first or last day it names. The exact dates are
			 * filtered by the validator, so a superset is safe.
			 */
			const attendanceSpan = employments.reduce(
				(span, employment) => {
					const exit = dateKey(employment.exit_date);
					const end =
						exit != null && exit > span.end && exit <= options.window.salary.end ? exit : span.end;
					return { start: span.start, end };
				},
				{ start: options.window.attendance.start, end: options.window.attendance.end }
			);
			const workDays = api.reads.assertComplete(
				yield* db.work_days.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: {
							gte: addDays(attendanceSpan.start, -1),
							lte: addDays(attendanceSpan.end, 1)
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
			// Rostered employments have no pattern day, so their guaranteed or capped load is
			// validated here, over the pay window where the money is — the arithmetic the roster
			// publication gate used to run.
			const [terms, codes] = yield* Effect.all(
				[
					db.employment_terms.findMany({
						where: { employment_id: { in: employmentIds } },
						columns: {
							id: true,
							employment_id: true,
							pay_frequency: true,
							shift_pattern_id: true,
							effective_range: true
						},
						limit: PAGE_LIMIT
					}),
					db.shift_definitions.findMany({
						where: { settings_code: { eq: options.configuration.company.settings_code } },
						columns: { id: true, variant: true },
						limit: PAGE_LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
			api.reads.assertComplete(terms, 'precheck employment terms');
			api.reads.assertComplete(codes, 'precheck roster codes');
			const termsByEmployment = new Map<string, typeof terms>();
			for (const term of terms) {
				const bucket = termsByEmployment.get(term.employment_id) ?? [];
				bucket.push(term);
				termsByEmployment.set(term.employment_id, bucket);
			}
			// Each employment is validated over the window its own cadence is paid on, the same
			// resolution `gather.ts` settles it under, and one whose cadence has nothing to pay in
			// this period (a monthly employment in a semi-monthly first half) is not in the run.
			const company = options.configuration.company;
			const settled = employments.flatMap((employment) => {
				const terms = termsByEmployment.get(employment.id) ?? [];
				const payFrequency = employmentPayFrequency(terms, options.window.salary.end);
				const cadence = paysOn(company, payFrequency)
					? cadenceWindow(options.window.period, company, payFrequency)
					: options.window;
				if (cadence == null) return [];
				const settlement = resolveEmploymentSettlement({
					dates: employmentDates(employment),
					window: cadence
				});
				return settlement.employedDays == null
					? []
					: [{ employment, terms, window: settlement.attendance }];
			});
			issues.push(
				...validateRosteredExpectations({
					period: options.window.period,
					window: options.window.attendance,
					employments: settled.map(({ employment, terms: employmentTerms, window }) => ({
						id: employment.id,
						employee_number: employment.employee_number,
						window,
						terms: employmentTerms.map((term) => ({
							id: term.id,
							pay_frequency: term.pay_frequency,
							work_pattern: termPattern(term, options.configuration.patternById),
							effective_range: term.effective_range
						})),
						workDays: (byEmployment.get(employment.id) ?? []).map((day) => ({
							work_date: day.work_date,
							shift_definition_id: day.shift_definition_id
						}))
					})),
					...rosteredWorkCodeMaps(codes)
				})
			);
		}
		return blockers(issues);
	});
}
