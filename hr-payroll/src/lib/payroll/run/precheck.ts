/**
 * What has to be true *before* a payroll run record exists.
 *
 * The run's transform refuses ahead of the write: nothing is inserted, so there is nothing to
 * undo. The checks that can refuse a run on facts knowable before it is built live here, and the
 * engine keeps its own copies. That duplication is deliberate: these two run at different moments,
 * and the gap between them is real. A clock opened after this passes and before the build reaches
 * it must still stop the build — the engine's checks are what make the payslips right, and these
 * are what keep a refusal from leaving a record behind.
 */

import { atWorksite, type Configuration } from './configuration.js';
import type { EmploymentBundle } from './gather.js';
import type { PayrollWindow } from './period.js';
import { termPattern } from '../../../lib/scheduling/work-pattern.js';
import { dateKey } from '../../../lib/iso-day.js';
import { addDays } from './dates.js';
import {
	blockers,
	rosteredWorkCodeMaps,
	validateConfiguration,
	validateOpenWorkDays,
	validateRosteredExpectations,
	type RunIssue
} from './validate.js';
import { dutyBlockIssues } from '../../checks.js';
import { dutyTypesOf } from '../../obligations/materialise.js';
import { entityFactsOwed, owedIssues, type OwedInput } from '../../facts-owed.js';
import { referenceCodes } from '../../expressions/functions/tables.js';
import { settingsInForce } from '../../jurisdiction_settings.js';
import { live } from './effective.js';
import type { PayrollWorld } from '../world.js';

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
 * - **declared facts owed** (`facts-owed.ts`, with `world`) and **duties that block a run** (`openDuties`),
 *   whose verdicts the build would reach one refusal at a time.
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
		| 'employee'
		| 'termsHistory'
		| 'workDays'
		| 'rosters'
		| 'attendance'
		| 'employedDays'
		| 'deferral'
	>[];
	/**
	 * The duty codes OPEN on this run's company or on an earlier run of it (`obligation_instances`, state OPEN): a
	 * duty type that `blocks: RUN` refuses the run while one is open.
	 */
	readonly openDuties?: readonly string[] | undefined;
	/**
	 * The run's world: every declared fact the build would refuse on (`facts-owed.ts`) refuses the run here, all at
	 * once, the list the obligation reminders hold.
	 */
	readonly world?: PayrollWorld | undefined;
}): RunIssue[] {
	const issues: RunIssue[] = validateConfiguration(options.configuration);
	if (options.world != null) issues.push(...owedIssues(entityFactsOwed(owedInput(options))));
	issues.push(
		...dutyBlockIssues({
			duties: dutyTypesOf(options.configuration.jurisdiction),
			block: 'RUN',
			open: options.openDuties ?? [],
			subject: options.configuration.company.name,
			collection: 'companies',
			recordId: options.configuration.company.id
		})
	);
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
		// A joiner or leaver owes rostered days only while employed: the cycle's other days are not
		// theirs to fill.
		const employed = bundle.employedDays ?? bundle.attendance;
		for (const roster of bundle.rosters) {
			const start = [roster.start, bundle.attendance.start, employed.start].sort().at(-1)!;
			const end = [roster.end, bundle.attendance.end, employed.end].sort()[0]!;
			const missing: string[] = [];
			for (let date = start; date <= end; date = addDays(date, 1))
				if (byDate.get(date)?.shift_definition_id == null) missing.push(date);
			if (missing.length > 0)
				issues.push({
					code: 'ROSTER_INCOMPLETE',
					message:
						`${bundle.employment.employee_number}'s roster of record for ${roster.start.slice(0, 7)} ` +
						`names no shift on ${missing.length} day(s) inside this cycle: ` +
						`${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}. A roster ` +
						'covers every employed day of its month; import the whole month or remove the roster.',
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
				})),
				holidayDates: new Set(
					atWorksite(
						options.configuration,
						bundle.termsHistory,
						bundle.workDays,
						bundle.employee
					).holidays.keys()
				)
			})),
			...rosteredWorkCodeMaps([...options.configuration.shiftById.values()])
		})
	);
	return blockers(issues);
}

/** The run's world as the facts-owed list reads it: the company's live employments, their people and terms. */
function owedInput(options: {
	readonly configuration: Configuration;
	readonly window: PayrollWindow;
	readonly world?: PayrollWorld | undefined;
}): OwedInput {
	const { configuration, world } = options;
	const code = configuration.jurisdiction.code;
	const versionOn = (day: string) => settingsInForce(configuration.lineageVersions, code, day);
	const employments = live(world?.employments ?? []).filter(
		(row) => row.company_id === configuration.company.id
	);
	const ids = new Set(employments.map((row) => row.id));
	const people = new Set(employments.map((row) => row.employee_id));
	return {
		asOf: options.window.salary.end,
		window: options.window.salary,
		versionOn,
		company: configuration.company,
		companyFactRevisions: configuration.companyFactRevisions,
		employments,
		employees: live(world?.employees ?? []).filter((row) => people.has(row.id)),
		terms: live(world?.employment_terms ?? []).filter((row) => ids.has(row.employment_id)),
		personFacts: live(world?.person_facts ?? []).filter((row) => people.has(row.employee_id)),
		evidence: new Set(
			live(world?.fact_evidence ?? []).map(
				(row) => `${row.subject.collection}:${row.subject.id}:${row.fact_key}`
			)
		),
		codesOn: (day) =>
			referenceCodes(
				configuration.referenceRows.get((versionOn(day) ?? configuration.jurisdiction).id) ?? [],
				day
			)
	};
}
