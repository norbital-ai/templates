import { oilExceptions, type OilCandidate, type OilException } from '../../scheduling/oil-exceptions.js';

/**
 * Build the person set for the month board's local unresolved-clock-out prefilter.
 *
 * The caller passes the values of its already-loaded month facts map. Keeping this helper pure is
 * the regression boundary that prevents the eye control from growing a second person-day query.
 */
export function unresolvedClockOutEmploymentIds(
	facts: Iterable<Readonly<{ employmentId: string; status: string }>>
): ReadonlySet<string> {
	const affected = new Set<string>();
	for (const day of facts) {
		if (day.status === 'OPEN') affected.add(day.employmentId);
	}
	return affected;
}

/**
 * The month's pending time-off-in-lieu decisions, and the people they concern.
 *
 * A list of exceptions beside a board of person-days is two places to read the same month, so this
 * is a prefilter like the clock-out eye rather than a second surface: narrowing the board *is* the
 * list, and the day sheet behind each cell is where the credit is created or removed. OIL is never
 * issued automatically — that is the controller's decision — so all the board owes is the flag.
 *
 * A day carries a premium when the calendar makes it a holiday or the person's own baseline makes
 * it a rest day. The compensation choice lives on the `work_days` row rather than on the rendered
 * fact, so the caller passes both and they are joined here by the row the fact already names.
 */
export function oilDecisionsOfMonth(
	facts: Iterable<
		Readonly<{
			employmentId: string;
			date: string;
			workDayId: string | null;
			holidayName: string | null;
			baseKind: string | null;
			workedIntervalCount: number;
		}>
	>,
	workDays: readonly Readonly<{ id: string; compensation?: string | null }>[]
): { readonly exceptions: readonly OilException[]; readonly employmentIds: ReadonlySet<string> } {
	const compensationById = new Map(workDays.map((row) => [row.id, row.compensation ?? 'PAY']));
	const candidates: OilCandidate[] = [];
	for (const fact of facts) {
		if (fact.workDayId == null) continue;
		candidates.push({
			id: fact.workDayId,
			employment_id: fact.employmentId,
			work_date: fact.date,
			compensation: compensationById.get(fact.workDayId) ?? 'PAY',
			worked: fact.workedIntervalCount > 0,
			premium: fact.holidayName != null || fact.baseKind === 'REST'
		});
	}
	const exceptions = oilExceptions(candidates);
	return {
		exceptions,
		employmentIds: new Set(exceptions.map((row) => row.employment_id))
	};
}
