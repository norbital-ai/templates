import { dateKey, isCalendarDate } from '../iso-day.js';
import { obligationContext, type DutyEvent } from '../obligations/materialise.js';

type Facts = Readonly<Record<string, boolean | number | string>>;

/** The moments of a case a CASE duty listens for, as `trigger.ref`. */
export const CASE_MOMENTS = ['APPLICATION', 'EVENT', 'AWARD'] as const;

/**
 * The CASE_EVENT duty events a saved case raises: its application, its event and its recorded award,
 * each dated and keyed by `trigger.ref`, so a duty type's `when` picks its moment
 * (`trigger.ref == 'APPLICATION'`) and its `due` counts from `trigger.date`. Pure; the obligation
 * calendar materialises them against the lineage in force on each date.
 */
export function caseDutyEvents(row: {
	readonly id: string;
	readonly case_type: string;
	readonly application_on?: string | null | undefined;
	readonly event_on?: string | null | undefined;
	readonly awarded_on?: string | null | undefined;
	readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
}): DutyEvent[] {
	const facts = Object.fromEntries(
		Object.entries(row.facts ?? {}).filter((entry): entry is [string, boolean | number | string] =>
			['boolean', 'number', 'string'].includes(typeof entry[1])
		)
	) as Facts;
	const days = [row.application_on, row.event_on, row.awarded_on];
	return CASE_MOMENTS.flatMap((ref, index) => {
		const date = dateKey(days[index]);
		return isCalendarDate(date)
			? [
					{
						on: 'CASE_EVENT' as const,
						subject: { kind: 'CASE' as const, id: row.id },
						ref,
						date,
						context: obligationContext({
							case: { type: row.case_type, facts },
							event: { facts }
						})
					}
				]
			: [];
	});
}
