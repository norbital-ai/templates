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

import type { Configuration } from './configuration.js';
import type { EmploymentBundle } from './gather.js';
import type { PayrollWindow } from './period.js';
import { termPattern } from '../../../lib/scheduling/work-pattern.js';
import { dateKey } from '../../../lib/iso-day.js';
import { addDays } from '../../../lib/period.js';
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
	readonly configuration: Configuration;
	readonly window: PayrollWindow;
	/** The employments the run pays, as `gatherRun` bundled them: their terms and their work days. */
	readonly bundles: readonly Pick<
		EmploymentBundle,
		| 'employment'
		| 'termsHistory'
		| 'workDays'
		| 'rosters'
		| 'attendance'
		| 'employedDays'
		| 'deferral'
	>[];
}): RunIssue[] {
	const issues: RunIssue[] = validateConfiguration(options.configuration);
	if (options.bundles.length === 0) return issues;
	// Re-shaped into the bundles `validateOpenWorkDays` reads, rather than reimplementing what an
	// unclosed interval is. The rule and its sentence live in one place, and this is only a second
	// way of reaching it — a second implementation would be a second chance to disagree with the
	// build about what "open" means, and disagreeing here would refuse runs the engine would have
	// accepted.
	issues.push(
		...validateOpenWorkDays({
			bundles: options.bundles.map((bundle) => ({
				employment: { employee_number: bundle.employment.employee_number },
				workDays: bundle.workDays
			}))
		})
	);
	// Rostered employments have no pattern day, so their guaranteed or capped load is validated
	// here, over the window each employment is paid on — the same resolution `gather.ts` settled
	// it under. A deferred joining period pays nobody and is not judged.
	const settled = options.bundles.filter(
		(bundle) => bundle.employedDays != null && bundle.deferral == null
	);
	// A roster of record is whole or it is not one: a rostered day inside the paid window makes
	// every other day of that window owe a rostered row with a shift. Refused here, before the
	// build, because pricing a half roster would price the other half off the pattern in silence.
	for (const bundle of settled) {
		const byDate = new Map(bundle.workDays.map((day) => [dateKey(day.work_date), day]));
		for (const roster of bundle.rosters) {
			const start = roster.start > bundle.attendance.start ? roster.start : bundle.attendance.start;
			const end = roster.end < bundle.attendance.end ? roster.end : bundle.attendance.end;
			const missing: string[] = [];
			for (let date = start; date <= end; date = addDays(date, 1))
				if (byDate.get(date)?.shift_definition_id == null) missing.push(date);
			if (missing.length > 0)
				issues.push({
					code: 'ROSTER_INCOMPLETE',
					message:
						`${bundle.employment.employee_number}'s roster of record for ${roster.start} to ` +
						`${roster.end} names no shift on ${missing.length} day(s): ` +
						`${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}. A roster ` +
						'covers every day of the payroll cycle; import the whole cycle or remove the roster.',
					collection: 'rosters'
				});
		}
	}
	issues.push(
		...validateRosteredExpectations({
			period: options.window.period,
			window: options.window.attendance,
			employments: settled.map((bundle) => ({
				id: bundle.employment.id,
				employee_number: bundle.employment.employee_number,
				window: bundle.attendance,
				terms: bundle.termsHistory.map((term) => ({
					id: term.id,
					pay_frequency: term.pay_frequency,
					work_pattern: termPattern(term, options.configuration.patternById),
					effective_range: term.effective_range
				})),
				workDays: bundle.workDays.map((day) => ({
					work_date: day.work_date,
					shift_definition_id: day.shift_definition_id
				}))
			})),
			...rosteredWorkCodeMaps([...options.configuration.shiftById.values()])
		})
	);
	return blockers(issues);
}
