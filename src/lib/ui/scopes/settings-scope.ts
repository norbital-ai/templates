/**
 * Client-side scoping by jurisdiction settings lineage.
 *
 * A company binds to a lineage by `settings_code`, and every catalogue row (leave catalogue entries, pay
 * components, schemes) belongs to one version of it through `settings_id`. A page that
 * shows an entity's catalogue therefore asks for rows whose version is on the lineage, or whose
 * version is the one in force on a day, as one relationship predicate on the child query rather
 * than a second query for the versions.
 */
import { PlainDate } from '@norbital-ai/std/date';
import { dateKey } from '../../payroll_engine/foundation/time.js';

/** Every version of the lineage, draft, sealed and voided alike: what a code-to-name map reads. */
export function onLineage(code: string) {
	return { code: { eq: code }, approval_id: { isNull: true } } as const;
}

/**
 * The sealed, unvoided version of the lineage whose period contains a day (both ends inclusive,
 * so exactly one version of a sealed lineage matches). `day` may be a stored range bound (a leaver's `effective_range`
 * end is the last millisecond of the day in the payroll zone); it is read as its business day.
 */
export function inForceSettings(code: string, day: string) {
	return {
		code: { eq: code },
		approval_id: { isNull: true },
		sealed_at: { isNull: false },
		voided_at: { isNull: true },
		effective_range: { contains: PlainDate(dateKey(day)) }
	} as const;
}

/** Native jurisdiction periods have inclusive calendar-day bounds. */
export function formatSettingsRange(range: {from: string; to: string | null} | null) {
 if (range == null) return '—';
 const display = (day: string) => new Intl.DateTimeFormat('en-GB', {day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`));
 return `${display(range.from)} – ${range.to == null ? 'open' : display(range.to)}`;
}
