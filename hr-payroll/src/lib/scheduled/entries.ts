/**
 * Scheduled catalogue entries, pure over read rows.
 *
 * A catalogue row that declares a `schedule` is a mandatory payment nobody has to ask for: PH 13th
 * month by 24 December, ID THR seven days before the worker's own religious holiday, a leave year's
 * unused days paid at its end. Its `due` expression yields the legal due days of a year for one
 * person; each is an occurrence, raised once as a held pay request from `raise_days_before` days
 * ahead and recorded in the obligation ledger with that due day, so an unpaid one reads LATE.
 *
 * The ledger instance is the raise's durable mark: an occurrence already in the ledger is never
 * raised again, whatever became of its request (rejected, deleted, consumed). An entry of the class
 * already on file — raised by hand, or settled by a payslip — stands for the occurrence nearest its
 * date, so it is recorded but not raised. Nothing here edits an entry.
 */

import { evaluateExpression, expressionEngine } from '../expressions/evaluate.js';
import { isEligible, type PersonContext } from '../payroll/run/eligibility.js';
import { addDays } from '../payroll/run/dates.js';
import { isCalendarDate } from '../iso-day.js';
import { resolveHolidays, type HolidayRow } from '../holiday-calendar.js';
import {
	materialise,
	obligationContext,
	type DutyType,
	type ObligationInput
} from '../obligations/materialise.js';

/** `adhoc_catalogue.schedule` / `leave_catalogue.schedule`, as stored. */
export type CatalogueSchedule = {
	readonly due: string;
	readonly raise_days_before?: number | null;
	readonly population?: string | null;
	readonly duty: string;
};

/** How long after its due day a missed occurrence is still raised (a day the sweep did not run). */
export const CATCH_UP_DAYS = 31;

/** An occurrence's identity under its employment: the ledger's `trigger_ref`. */
export const scheduledRef = (code: string, due: string) => `${code}:${due}`;

/** The due days a schedule's expression yields: one day or a list; sorted, unique. */
export function dueDays(expression: string, context: object): string[] {
	const value = evaluateExpression(expressionEngine, expression, context);
	const days = (Array.isArray(value) ? value : [value]).map(String);
	const bad = days.find((day) => !isCalendarDate(day));
	if (bad != null)
		throw new Error(`The schedule "${expression}" produced ${bad}, not a YYYY-MM-DD day.`);
	return [...new Set(days)].sort();
}

/** One day of the `holidays` root: `religions` are the upper-cased names of `jurisdiction_holidays.religion`. */
export type ScheduleHoliday = {
	readonly date: string;
	readonly name: string;
	readonly kind: string;
	readonly religions: readonly string[];
};

/** The person's published days of one year, as their worksite and each row's `applies_when` place them. */
export function holidaysOf(
	rows: readonly (HolidayRow & { readonly religion?: string | null })[],
	companyId: string,
	year: number,
	worksiteOn: (date: string) => string | null | undefined,
	appliesOn: (expression: string, date: string) => boolean
): ScheduleHoliday[] {
	const byId = new Map<string, (typeof rows)[number]>(rows.map((row) => [row.id, row]));
	return [
		...resolveHolidays(
			rows,
			companyId,
			`${year}-01-01`,
			`${year}-12-31`,
			worksiteOn,
			appliesOn
		).values()
	].map((day) => ({
		date: day.date,
		name: day.name,
		kind: day.kind,
		religions: (byId.get(day.id)?.religion ?? '')
			.split(',')
			.map((name) => name.trim().toUpperCase())
			.filter((name) => name !== '')
	}));
}

/** `applies_when` read over the person on each day. */
export const personCondition =
	(personOn: (date: string) => PersonContext) => (expression: string, date: string) =>
		isEligible(expression, personOn(date));

/** The occurrence a recorded entry stands for: the due day nearest its date, the earlier on a tie. */
export function nearestDue(dues: readonly string[], day: string): string | null {
	const at = Date.parse(`${day}T00:00:00Z`);
	let best: string | null = null;
	let gap = Infinity;
	for (const due of dues) {
		const distance = Math.abs(Date.parse(`${due}T00:00:00Z`) - at);
		if (distance < gap || (distance === gap && best != null && due < best)) {
			best = due;
			gap = distance;
		}
	}
	return best;
}

/** What to do with one occurrence today: raise its request and record it, or only record it. */
export type OccurrencePlan = { readonly due: string; readonly raise: boolean };

/**
 * The occurrences of one person and class to act on today: each due day whose raise window has
 * opened (`due - raise_days_before <= today`) and not closed (`today <= due + CATCH_UP_DAYS`), that
 * the person is owed, and that the ledger does not hold. An entry of the class on file (any state)
 * claims its nearest due day, which is then recorded without a second request.
 */
export function planOccurrences(options: {
	readonly today: string;
	/** Every due day of the candidate years, so an entry is matched to its own occurrence. */
	readonly dues: readonly string[];
	readonly raiseDaysBefore: number;
	readonly recorded: (due: string) => boolean;
	readonly entryDates: readonly string[];
	readonly owed: (due: string) => boolean;
}): OccurrencePlan[] {
	const claimed = new Set(options.entryDates.flatMap((day) => nearestDue(options.dues, day) ?? []));
	return options.dues.flatMap((due) =>
		addDays(due, -options.raiseDaysBefore) > options.today ||
		addDays(due, CATCH_UP_DAYS) < options.today ||
		options.recorded(due) ||
		!options.owed(due)
			? []
			: [{ due, raise: !claimed.has(due) }]
	);
}

/** The SCHEDULED employment duty a schedule names in a version, or null where it declares none. */
export const scheduledDuty = (duties: readonly DutyType[], code: string) =>
	duties.find(
		(duty) => duty.code === code && duty.subject === 'EMPLOYMENT' && duty.trigger.on === 'SCHEDULED'
	) ?? null;

/** The ledger instance of one occurrence: due on the legal day, triggered on the day it was raised. */
export function scheduledInstance(options: {
	readonly duty: DutyType;
	readonly settingsId: string;
	readonly companyId: string;
	readonly employmentId: string;
	readonly code: string;
	readonly due: string;
	readonly today: string;
	readonly currency?: string | undefined;
	readonly existing: ReadonlySet<string>;
}): ObligationInput | null {
	const [row] = materialise({
		duties: [options.duty],
		settingsId: options.settingsId,
		companyId: options.companyId,
		currency: options.currency,
		event: {
			on: 'SCHEDULED',
			subject: { kind: 'EMPLOYMENT', id: options.employmentId },
			ref: scheduledRef(options.code, options.due),
			date: options.due,
			context: obligationContext()
		},
		existing: options.existing
	});
	return row == null ? null : { ...row, triggered_on: options.today };
}
