/**
 * Facts owed as obligation reminders: every declared fact the company's next regular run would refuse on
 * (`entityFactsOwed`) is one FACT_OWED instance per subject and fact key, due on that run's pay date, and closes on
 * the sweep after the fact is recorded. Pure; the `obligation_calendar` sweep writes what it returns.
 */
import type { OwedFact } from '../facts-owed.js';
import { companyPeriods, payDateFor } from '../ui/calendar.js';
import { monthBounds, periodMonth, shiftPeriod } from '../payroll/run/dates.js';
import { FACT_OWED, instanceKey, type ObligationInput } from './materialise.js';

/** The period the next REGULAR run pays, its salary month and pay date: after the latest REGULAR run, else today's. */
export function nextRegularRun(
	regularPeriods: readonly string[],
	payFrequency: string,
	today: string
): {
	readonly period: string;
	readonly window: { start: string; end: string };
	readonly payDate: string;
} {
	const latest = regularPeriods.toSorted().at(-1);
	const month = periodMonth(latest ?? today.slice(0, 7));
	const periods = companyPeriods([month, shiftPeriod(month, 1)], payFrequency);
	const period =
		latest == null
			? periods.find((one) => payDateFor(one, payFrequency) >= today)!
			: periods[periods.indexOf(latest) + 1]!;
	return {
		period,
		window: monthBounds(periodMonth(period)),
		payDate: payDateFor(period, payFrequency)
	};
}

type Reminder = {
	readonly id: string;
	readonly state: string;
	readonly duty_code: string;
	readonly subject_kind: string;
	readonly subject_id: string;
	readonly trigger_ref: string;
};

/**
 * The reminders to raise (a fact owed with none recorded for its subject and key) and the OPEN ones to close (their
 * fact no longer owed). `reminders` are the company's FACT_OWED instances in every state.
 */
// ponytail: one reminder per subject and key for good; a fact owed again after its reminder closed raises none.
export function factReminders(options: {
	readonly companyId: string;
	readonly settingsId: string;
	readonly dueOn: string;
	readonly today: string;
	readonly owed: readonly OwedFact[];
	readonly reminders: readonly Reminder[];
}): { readonly raise: ObligationInput[]; readonly close: string[] } {
	const keyed = new Map<string, ObligationInput>();
	for (const fact of options.owed) {
		const row: ObligationInput = {
			company_id: options.companyId,
			settings_id: options.settingsId,
			duty_code: FACT_OWED,
			authority: '',
			subject_kind: fact.employmentId == null ? 'COMPANY' : 'EMPLOYMENT',
			subject_id: fact.employmentId ?? options.companyId,
			trigger_ref: fact.key,
			triggered_on: options.today,
			due_on: options.dueOn,
			amount_due: null,
			retain_until: null,
			state: 'OPEN',
			facts: {}
		};
		keyed.set(instanceKey(row), row);
	}
	const recorded = new Set(options.reminders.map(instanceKey));
	return {
		raise: [...keyed].filter(([key]) => !recorded.has(key)).map(([, row]) => row),
		close: options.reminders
			.filter((row) => row.state === 'OPEN' && !keyed.has(instanceKey(row)))
			.map((row) => row.id)
	};
}
