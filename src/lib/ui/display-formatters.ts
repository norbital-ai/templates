/**
 * Read-only formatters for the values the app pages surface in table cells — the JSONB variants,
 * and every date this workspace prints.
 *
 * Every formatter parses defensively: a table cell must never throw on a row whose variant was
 * written by an older definition. There is no writing here — presentation only.
 */
import { Result, Schema } from 'effect';
import type { TenantI18nKeys } from '$bolt/i18n-keys';
import type { Translator } from './roster/roster-month.js';
import { PAYROLL_TIME_ZONE, calendarDateInTimeZone } from './calendar.js';
import { addDays } from '../../collections/payroll_runs/lib/dates.js';
import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
import { statutoryFactStatusSchema } from '../../datatypes/statutory_fact_status/+definition.js';
import { decodeNumber } from '@norbital-ai/std/json';

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
	if (typeof value !== 'string') return null;
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
 * A day-precision `instant()` column as the calendar day an operator picked — **`30 Jun 2026`**.
 *
 * A `precision: 'day'` column still stores an instant: `2026-06-30` picked in Kuala Lumpur is kept
 * as `2026-06-29T16:00:00.000Z`. Slicing the first ten characters of that prints the day before,
 * so a pay date read a day early off a run and an attendance window read a day early off the same
 * run were both a formatting shift, not a calculation. Stored dates come through here; values the
 * page itself computed as `YYYY-MM-DD` go through `formatCalendarDate` unchanged.
 */
export function formatCalendarInstant(value: unknown, fallback = '—'): string {
	if (typeof value !== 'string' || value === '') return fallback;
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) return fallback;
	return formatCalendarDate(calendarDateInTimeZone(at, PAYROLL_TIME_ZONE));
}

export function formatEffectiveRange(value: unknown): string {
	if (value == null || typeof value !== 'object') return '—';
	return `${formatCalendarInstant(Reflect.get(value, 'start'), '…')} → ${formatCalendarInstant(Reflect.get(value, 'end'), '∞')}`;
}

/**
 * A jurisdiction settings `effective_range` as the days it actually governs.
 *
 * Settings versions are read **half-open** — `[start, end)` — by `settingsInForce` and by the
 * database exclusion, so the stored `end` is the first day the successor governs, not the last day
 * this version does. Printing the stored bound unchanged made two adjacent snapshots read as if
 * both covered the seam day (SG_1 "01 Jan 2026 → 01 Apr 2026" beside SG_2 from 01 Apr 2026), so
 * this formatter prints the last governed day instead and renders the `9999-12-31` sentinel as an
 * open tail. `formatEffectiveRange` stays for the inclusive collections (terms, loans).
 */
export function formatSettingsRange(value: unknown): string {
	if (value == null || typeof value !== 'object') return '—';
	const start = formatCalendarInstant(Reflect.get(value, 'start'), '…');
	const end = Reflect.get(value, 'end');
	if (typeof end !== 'string' || Number.isNaN(Date.parse(end))) return `${start} – open`;
	const endDay = calendarDateInTimeZone(new Date(end), PAYROLL_TIME_ZONE);
	if (endDay.startsWith('9999')) return `${start} – open`;
	return `${start} – ${formatCalendarDate(addDays(endDay, -1))}`;
}

/**
 * The half-day-stepped range of a leave event, as one line.
 *
 * Two app pages print the same leave column, and a range that reads differently on the employee's
 * page and the controller's is two answers to one question.
 */
export function formatLeaveRange(event: LeaveEvent | null | undefined, t: Translator): string {
	if (event == null || event.kind !== 'TIME_OFF') return '—';
	const half = (part: 'FIRST' | 'SECOND') =>
		part === 'FIRST' ? t('component.first_half') : t('component.second_half');
	return `${formatCalendarDate(event.range.start.date)}, ${half(event.range.start.half)} → ${formatCalendarDate(event.range.end.date)}, ${half(event.range.end.half)}`;
}

export function formatStatutoryFactStatus(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(statutoryFactStatusSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.status_invalid');
	const status = parsed.success;
	return status.kind === 'REGISTERED'
		? `${t('component.status_registered', { reference: status.reference_number })}${
				status.rate_override == null
					? ''
					: t('component.status_override', { rate: status.rate_override })
			}`
		: t('component.status_not_registered', { reason: status.reason });
}
