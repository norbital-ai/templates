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
