/**
 * When a balance is worth showing.
 *
 * One rule for leave, claims and allowances: a balance list is a list of things a person can take,
 * so a component they have no ceiling for and no history against is omitted rather than printed as
 * a 0.00 row. An unlimited grant is always a real balance, even though its numbers are null, and a
 * component with activity stays visible after its ceiling is spent or its window has ended.
 *
 * Keeping this in one place is the point: the three families must answer "is this a balance?" the
 * same way, or the leave list and the entry picker drift apart again.
 */
export const hasSomethingToShow = (shape: {
	/** An unmetered grant — a real balance whose figures are null. */
	readonly unlimited: boolean;
	/** The period's ceiling, or null where the component states none. */
	readonly ceiling: number | null;
	/** What has been earned by the as-of date, or null where the family does not meter. */
	readonly earned: number | null;
	/** Whether the record carries any activity for this component (an entry, a request, a capture). */
	readonly activity: boolean;
}): boolean =>
	shape.unlimited || (shape.ceiling ?? 0) > 0 || (shape.earned ?? 0) > 0 || shape.activity;
