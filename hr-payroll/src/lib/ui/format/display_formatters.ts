/**
 * Read-only formatters for the values the app pages surface in table cells — the JSONB variants,
 * and every date this workspace prints.
 *
 * Every formatter parses defensively: a table cell must never throw on a row whose variant was
 * written by an older definition. There is no writing here — presentation only.
 */
import type { MessageKey } from '@norbital-ai/bolt';
import { governed } from '../scopes/settings_scope.js';
import { dateKey, numberOf } from '../../payroll_engine/foundation.js';
import * as Predicate from 'effect/Predicate';
import { Result } from 'effect';

/** A message catalogue lookup: `bolt.t`, or a test's stand-in. */
type Translator = (key: MessageKey, vars?: { readonly [name: string]: string | number }) => string;

// `negative`: a zero (a −0 total, an amount rounding to nothing) prints unsigned.
const DECIMAL = new Intl.NumberFormat(undefined, {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
	signDisplay: 'negative'
});

/** An amount of a currency at that currency's minor units (JPY and VND none, SGD two), as `Intl` knows them. */
const inCurrency = (currency: string): Intl.NumberFormat => {
	return Result.getOrElse(
		Result.try(() => {
			const digits = new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency
			}).resolvedOptions().maximumFractionDigits;
			return new Intl.NumberFormat(undefined, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
				signDisplay: 'negative'
			});
		}),
		() => DECIMAL
	);
};

/**
 * A `numeric()` column arrives as a string; render it without inventing precision: `minorUnits` (the version's
 * `minor_units`) when given, else the currency's own digits (IDR and JPY none, SGD two), else two.
 */
export function formatNumeric(
	value: unknown,
	currency?: string | null,
	minorUnits?: number | null
): string {
	if (value == null || value === '') return '—';
	const parsed = numberOf(value);
	if (parsed == null) return String(value);
	if (minorUnits != null) return atDigits(minorUnits).format(parsed);
	return (currency == null || currency === '' ? DECIMAL : inCurrency(currency)).format(parsed);
}

const atDigits = (digits: number): Intl.NumberFormat =>
	new Intl.NumberFormat(undefined, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
		signDisplay: 'negative'
	});

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
