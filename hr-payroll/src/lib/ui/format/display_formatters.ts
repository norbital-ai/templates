/**
 * Read-only formatters for the values the app pages surface in table cells — the JSONB variants,
 * and every date this workspace prints.
 *
 * Every formatter parses defensively: a table cell must never throw on a row whose variant was
 * written by an older definition. There is no writing here — presentation only.
 */
import type { MessageKey } from '../i18n/t.js';
import { governed } from '../scopes/settings_scope.js';
import { dateKey, decodeNumber } from '../../payroll_engine/foundation.js';
import * as Predicate from 'effect/Predicate';

/** A message catalogue lookup: `bolt.t`, or a test's stand-in. */
export type Translator = (
	key: MessageKey,
	vars?: { readonly [name: string]: string | number }
) => string;

const DECIMAL = new Intl.NumberFormat(undefined, {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** A `numeric()` column arrives as a string; render it without inventing precision. */
export function formatNumeric(value: unknown): string {
	if (value == null || value === '') return '—';
	const parsed = decodeNumber(value);
	return Number.isFinite(parsed) ? DECIMAL.format(parsed) : String(value);
}

const HOURS = new Intl.NumberFormat(undefined, {
	minimumFractionDigits: 0,
	maximumFractionDigits: 2
});

/**
 * An integer-minutes column presented as hours.
 *
 * The column stays minutes — minutes are the exact unit the overtime and export arithmetic measures
 * in, and every half-hour a rota actually uses is a whole number of them. Only the label the
 * operator reads changes, so no stored value is reinterpreted.
 *
 * Deliberately *not* rounded to the half hour: the half-hour step belongs to the input, which is
 * where the operator's intent is expressed. A row that already holds 45 minutes must read `0.75 h`
 * and not be quietly reported as `0.5 h` — display that disagrees with storage is how a payroll
 * dispute starts.
 */
export function formatDurationHours(value: unknown, t: Translator): string {
	if (value == null || value === '') return '—';
	const minutes = decodeNumber(value);
	if (!Number.isFinite(minutes)) return '—';
	return t('component.hours_short', { hours: HOURS.format(minutes / 60) });
}
/**
 * A `YYYY-MM-DD` calendar day from a day-precision instant, or `null` when there is not one.
 * Strings are read as characters and never routed through `Date`: precision changes presentation,
 * not the one ISO-string record shape.
 */
function calendarDayFrom(value: unknown): string | null {
	if (!Predicate.isString(value)) return null;
	return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * The one date format this workspace prints: **`05 Aug 2026`** — day, month, year.
 *
 * Every on-screen date goes through here so the workspace never shows two shapes for the same
 * value. The month is a *name*, not a number, because this template serves Malaysian, Philippine
 * and Indonesian payroll in one interface: `05/08/2026` reads as 5 August to one operator and
 * 8 May to the next, and a misread pay date or work date is a real payroll error. The day is
 * zero-padded so the column stays a fixed width down a table.
 *
 * The format is fixed en-GB over a UTC day, not viewer-locale-derived: `Intl` with the viewer's
 * locale would put the month first for a viewer in the United States, which is the ambiguity this
 * format exists to remove.
 *
 * Takes a **calendar day**.
 */
const CALENDAR_DATE = new Intl.DateTimeFormat('en-GB', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});

export function formatCalendarDate(value: unknown): string {
	const day = calendarDayFrom(value);
	if (day === null) return '—';
	return CALENDAR_DATE.format(new Date(`${day}T00:00:00.000Z`));
}

/** The days a contract's terms hold across: "from 1 Jan 2026", or "1 Jan 2026 – 4 Jan 2026". */
export function formatTermsDates(
	row: { readonly effective_range: unknown },
	t: Translator
): string {
	const range = governed(row.effective_range);
	if (range == null) return '—';
	const start = formatCalendarDate(dateKey(range.from));
	return range.to == null
		? t('component.revision_from', { start })
		: t('component.revision_between', { start, end: formatCalendarDate(dateKey(range.to)) });
}

/**
 * A `custom('instant_range', { precision: 'day' })` value `{ start, end }` of UTC ISO instants, as the two calendar days an operator
 * picked.
 *
 * The bound is an *instant*, so it is resolved through the payroll timezone rather than sliced.
 * `'2026-03-01'` picked in Kuala Lumpur is stored as `2026-02-28T16:00:00.000Z`; taking the first
 * ten characters of that would report the range as starting the day before it does, and effective
 * dating is what decides which rate row prices a run. Every screen that prints an effective range
 * resolves it here, so a rate window cannot read one way on a form and another in a table.
 */
/**
 * A jurisdiction settings `effective_range` as the days it governs: `{ from, to }`, both inclusive, an open tail
 * printed as open (`governed` also reads a bank row's half-open `{ start, end }`).
 */
export function formatSettingsRange(value: unknown): string {
	const days = governed(value);
	if (days == null) return '—';
	return `${formatCalendarDate(days.from)} – ${days.to == null ? 'open' : formatCalendarDate(days.to)}`;
}
