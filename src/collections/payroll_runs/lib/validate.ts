/**
 * Step 2 — VALIDATE.
 *
 * Everything that can be wrong before a single employee is read, plus the ceilings only a measured
 * run can test. A run that would silently under-contribute, silently not pay for work done, or
 * silently read a missing decision as "not chargeable" is stopped here, with a message that names
 * the row to fix.
 *
 * Configuration faults still fail the run: a missing treatment, an unmapped rest-day rule, or a
 * pay cadence the company calendar cannot express. Hours-of-work ceilings do not. A regime limit
 * with `on_exceed=WARN` (and every daily hours breach, which the engine already reclassifies to
 * OVERTIME_EXCESS) is reported and the run still builds — Infotech paid those months, and refusing
 * the whole payroll because one person worked 12.3 hours hides every loan, leave and claim the
 * operator came to settle. `on_exceed=BLOCK` on a monthly overtime ceiling still stops the run.
 *
 * Issues stay structured rather than free text, so a screen can link to the row that caused each
 * one, and every message names the employee, the day and the rule wherever a run has them to name.
 */

import type { Configuration } from './configuration.js';
import type { DailyOvertime } from './overtime.js';
import { parseSpecialRules } from './special-rules.js';

export type IssueSeverity = 'BLOCKER' | 'WARNING';

export type RunIssue = {
	readonly code: string;
	readonly message: string;
	readonly severity?: IssueSeverity;
	readonly collection?: string;
	readonly recordId?: string;
};

export function blockers(issues: readonly RunIssue[]): RunIssue[] {
	return issues.filter((issue) => issue.severity !== 'WARNING');
}

/** Configuration checks. None of them read a person. */
export function validateConfiguration(configuration: Configuration): RunIssue[] {
	const issues: RunIssue[] = [];
	const blocker = (code: string, message: string, collection?: string, recordId?: string): void => {
		issues.push({ code, message, collection, recordId });
	};

	if (configuration.jurisdiction.proration == null)
		blocker(
			'PRORATION_MISSING',
			`Jurisdiction ${configuration.jurisdiction.code} states no proration basis, so a partial ` +
				'month cannot be paid.',
			'jurisdictions',
			configuration.jurisdiction.norbital_id
		);

	// Every monetary component owns a decided cell for every effective statutory scheme.
	for (const component of configuration.payComponents) {
		if (component.nature === 'INFORMATION') continue;
		for (const contribution of configuration.contributions) {
			const cell = configuration.treatments.get(
				`${component.norbital_id}:${contribution.row.norbital_id}`
			);
			if (cell?.treatment == null) {
				blocker(
					'TREATMENT_MISSING',
					`No ${contribution.row.code} treatment exists for ${component.code}. Each component ` +
						'must state the decision in its policy.',
					'pay_components',
					component.norbital_id
				);
				continue;
			}
			if (cell.treatment.kind === 'UNSET')
				blocker(
					'TREATMENT_UNSET',
					`${component.code} × ${contribution.row.code} is undecided. Payroll cannot guess whether ` +
						'this kind of pay is chargeable.',
					'pay_components',
					component.norbital_id
				);
			if (
				cell.treatment.kind === 'SPECIAL' &&
				!contribution.row.special_rules.includes(cell.treatment.rule)
			)
				blocker(
					'SPECIAL_RULE_UNKNOWN',
					`${component.code} × ${contribution.row.code} names special rule "${cell.treatment.rule}", ` +
						`which ${contribution.row.code} does not declare.`,
					'pay_components',
					component.norbital_id
				);
		}
	}

	// ── the schemes ─────────────────────────────────────────────────────────────────────────────
	const sequenceById = new Map(
		configuration.contributions.map((entry) => [entry.row.norbital_id, Number(entry.row.sequence)])
	);
	for (const contribution of configuration.contributions) {
		const code = contribution.row.code;
		try {
			parseSpecialRules(contribution.row.special_rules, code);
		} catch (error) {
			blocker(
				'SPECIAL_RULE_INVALID',
				error instanceof Error ? error.message : String(error),
				'statutory_contributions',
				contribution.row.norbital_id
			);
		}
		if (contribution.rates.length === 0)
			blocker(
				'CONTRIBUTION_UNBANDED',
				`${code} has no rate bands effective for this period, so it could not charge anything.`,
				'statutory_contributions',
				contribution.row.norbital_id
			);
		const hasTerminalBand = contribution.rates.some((rate) => {
			const selector = rate.selector;
			if (selector == null) return false;
			return (selector.by === 'WAGE' || selector.by === 'WAGE_AND_AGE') && selector.to == null;
		});
		const isWageBanded =
			contribution.row.keyed_by === 'WAGE' || contribution.row.keyed_by === 'WAGE_AND_AGE';
		if (isWageBanded && contribution.rates.length > 0 && !hasTerminalBand)
			blocker(
				'CONTRIBUTION_NO_CEILING',
				`${code} has no open-ended terminal band. A ceiling is expressed as a band with no upper ` +
					'bound; without one, a wage above the highest band cannot be charged at all.',
				'contribution_rates',
				contribution.row.norbital_id
			);
		for (const relievedId of contribution.row.relief_for) {
			const relievedSequence = sequenceById.get(relievedId);
			if (relievedSequence == null) {
				blocker(
					'RELIEF_TARGET_MISSING',
					`${code} is a relief for a contribution that is not effective in this jurisdiction.`,
					'statutory_contributions',
					contribution.row.norbital_id
				);
				continue;
			}
			if (relievedSequence <= Number(contribution.row.sequence))
				blocker(
					'RELIEF_ORDER',
					`${code} is a relief inside a contribution that runs before it. A relief must be ` +
						'produced before the scheme that consumes it.',
					'statutory_contributions',
					contribution.row.norbital_id
				);
		}
	}

	// ── overtime completeness: a stated rule nobody pays is work done for nothing ────────────────
	const mappedRules = new Set(
		configuration.payComponents.flatMap((component) => {
			const definition = component.definition;
			if (definition == null || definition.source !== 'OVERTIME') return [];
			return [
				`${definition.rule.day_type}:${definition.rule.measure}:${definition.rule.band_from}`
			];
		})
	);
	for (const rule of configuration.overtimeRules) {
		const band = rule.band;
		if (band == null) {
			blocker(
				'OVERTIME_RULE_UNBANDED',
				`An overtime rule (${rule.authority}) carries no band and can never be entered.`,
				'jurisdictions',
				configuration.jurisdiction.norbital_id
			);
			continue;
		}
		const from = band.measure === 'BEYOND_NORMAL' ? band.from_hours : band.from_fraction;
		const key = `${rule.day_type}:${band.measure}:${from}`;
		if (mappedRules.has(key)) continue;
		// A `FROM_START_OF_DAY` rule used to be excused here as unreachable "while the hourly reading
		// is in force". It is reachable: `priceDay` awards the highest day-wage band a rest day or
		// public holiday entered, and a segment with no pay component behind it is a day's wages the
		// employee worked for and was not paid.
		issues.push({
			code: 'OVERTIME_RULE_UNMAPPED',
			message:
				`${configuration.jurisdiction.code} defines ${rule.day_type} ${band.measure} from ${from} ` +
				`(${rule.authority}); this company has no pay component for it. Work under that rule ` +
				'would be unpaid.',
			collection: 'jurisdictions',
			recordId: configuration.jurisdiction.norbital_id
		});
	}

	return issues;
}

/**
 * The overtime ceilings that only a measured run can test.
 *
 * `on_exceed` decides whether the run stops. `WARN` names the person, the month and the authority
 * and lets the payslips be written; `BLOCK` refuses the whole run.
 */
export function validateOvertimeLimits(options: {
	readonly configuration: Configuration;
	readonly employeeNumber: string;
	readonly calendarMonth: string;
	readonly monthHours: number;
}): RunIssue[] {
	return (
		options.configuration.overtimeLimits
			// `monthHours` is regulated *overtime*, so only a limit that counts overtime hours may be
			// compared against it. A TOTAL_WORK_HOURS row is a different quantity, not a stricter one.
			.filter(
				(limit) =>
					limit.period === 'MONTH' &&
					limit.measures === 'OVERTIME_HOURS' &&
					options.monthHours > Number(limit.max_hours)
			)
			.map((limit) => {
				const severity: IssueSeverity = limit.on_exceed === 'BLOCK' ? 'BLOCKER' : 'WARNING';
				const nextStep =
					severity === 'BLOCKER'
						? 'Reduce the recorded overtime, or raise the ceiling on the authority that states it, before this payroll can be built.'
						: 'The run will still be built; review the attendance or raise the ceiling if the hours should not stand.';
				return {
					code: 'OVERTIME_LIMIT_EXCEEDED',
					severity,
					message:
						`${options.employeeNumber} worked ${options.monthHours} regulated overtime hours in ` +
						`${options.calendarMonth}, against a ${limit.max_hours}-hour calendar-month ceiling ` +
						`(${limit.authority}, on_exceed=${limit.on_exceed}). ${nextStep}`,
					collection: 'jurisdictions',
					recordId: options.configuration.jurisdiction.norbital_id
				};
			})
	);
}

/**
 * A day past the hours-of-work limit.
 *
 * The excess is still routed to incentive OT rather than discarded, so the arithmetic is defined.
 * Historical vendor months contain many such days; refusing the whole run over them hides every
 * other settlement. The issue is a warning that names the person and the date.
 */
export function validateDailyWorkLimit(options: {
	readonly employeeNumber: string;
	readonly days: readonly DailyOvertime[];
	readonly maxWorkHours: number;
}): RunIssue[] {
	return options.days
		.filter((day) => day.totalWorkHours > options.maxWorkHours)
		.map((day) => ({
			code: 'DAILY_WORK_LIMIT_EXCEEDED',
			severity: 'WARNING' as const,
			message:
				`${options.employeeNumber} worked ${day.totalWorkHours.toFixed(2)} hours on ${day.date}, ` +
				`above the ${options.maxWorkHours}-hour daily limit. The run will still be built; ` +
				'correct the attendance for that day, or record why the hours stand.',
			collection: 'time_entries',
			recordId: day.timeEntryId
		}));
}

/**
 * Whether the company's pay calendar can express the cadence its people are actually paid on.
 *
 * `companies.pay_cutoff_day` and `pay_day` are one integer each, so they describe a **monthly**
 * calendar and nothing else — one window, one pay date, one run per month. An employment whose
 * terms say `SEMI_MONTHLY` is paid on a cadence this company cannot state, and payroll runs it on
 * the monthly calendar because that is the only calendar there is.
 *
 * That is a gap in the model, not a fault in the data, and it stops the run rather than being
 * papered over: paying a semi-monthly employee once a month on the monthly window is a wrong answer
 * that looks exactly like a right one on the payslip. Closing it needs `companies` to be able to
 * hold more than one cutoff and pay date, and `payroll_runs.period` to be able to name half a month.
 */
export function validatePayCalendar(options: {
	readonly configuration: Configuration;
	readonly bundles: readonly {
		readonly employment: { readonly employee_number: string; readonly norbital_id: string };
		readonly terms: readonly { readonly pay_frequency: string | null }[];
	}[];
}): RunIssue[] {
	const mismatched = options.bundles.filter((bundle) =>
		bundle.terms.some((row) => row.pay_frequency != null && row.pay_frequency !== 'MONTHLY')
	);
	if (mismatched.length === 0) return [];
	const cadences = [
		...new Set(
			mismatched.flatMap((bundle) =>
				bundle.terms.map((row) => row.pay_frequency).filter((value) => value !== 'MONTHLY')
			)
		)
	].join(', ');
	// Named, not counted: "3 employments" sends an operator hunting, and the whole point of failing
	// the run is that they can act on it.
	const named = mismatched.map((bundle) => bundle.employment.employee_number).toSorted();
	return [
		{
			code: 'PAY_CALENDAR_CADENCE_UNSUPPORTED',
			message:
				`${named.join(', ')} at ${options.configuration.company.name} are on ${cadences} terms, ` +
				'but a company states one cutoff day and one pay day, which can only describe a monthly ' +
				`calendar (cutoff ${options.configuration.company.pay_cutoff_day}). There is no window ` +
				'this payroll could run them on that matches what they were promised.',
			collection: 'companies',
			recordId: options.configuration.company.norbital_id
		}
	];
}

/** How many issues a failure message spells out before it starts counting. */
const DETAILED_ISSUE_LIMIT = 25;

/**
 * Why the payroll refused, in the operator's words rather than the engine's.
 *
 * Every issue is spelled out, one per line, because each one names a different person, day or rule
 * and "and 40 others" is not something anyone can act on. A very large failure is capped so the
 * message stays readable, and says plainly how many it did not print.
 */
export function describeIssues(
	issues: readonly RunIssue[],
	kind: 'block' | 'warn' = 'block'
): string {
	const messages = [...new Set(issues.map((issue) => `${issue.code}: ${issue.message}`))];
	const shown = messages.slice(0, DETAILED_ISSUE_LIMIT);
	const remaining = messages.length - shown.length;
	const headline =
		kind === 'warn'
			? messages.length === 1
				? 'Payroll built with one warning:'
				: `Payroll built with ${messages.length} warnings:`
			: messages.length === 1
				? 'Payroll was not built. One thing must be fixed first:'
				: `Payroll was not built. ${messages.length} things must be fixed first:`;
	const tail = remaining > 0 ? `\n… and ${remaining} more of the same kinds, listed above.` : '';
	return `${headline}\n${shown.map((message) => `• ${message}`).join('\n')}${tail}`;
}
