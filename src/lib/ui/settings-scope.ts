/**
 * Client-side scoping by jurisdiction settings lineage.
 *
 * A company binds to a lineage by `settings_code`, and every catalogue row (leave catalogue entries, pay
 * components, schemes) belongs to one version of it through `settings_id`. A page that
 * shows an entity's catalogue therefore asks for rows whose version is on the lineage, or whose
 * version is the one in force on a day, as one relationship predicate on the child query rather
 * than a second query for the versions.
 */
import { startOfDayInstant, PAYROLL_TIME_ZONE } from './calendar.js';

/** Every version of the lineage, draft, sealed and voided alike: what a code-to-name map reads. */
export function onLineage(code: string) {
	return { code: { eq: code }, approval_id: { isNull: true } } as const;
}

/**
 * The sealed, unvoided version of the lineage whose range contains a day. `contains_date` reads
 * the range end inclusively, so on the one day a successor begins both it and its predecessor
 * match; the engine's half-open pick decides that day, and a picker listing both for it is the
 * price of one query instead of two.
 */
export function inForceSettings(code: string, day: string) {
	return {
		code: { eq: code },
		approval_id: { isNull: true },
		sealed_at: { isNotNull: true },
		voided_at: { isNull: true },
		effective_range: { contains_date: startOfDayInstant(day, PAYROLL_TIME_ZONE) }
	} as const;
}
