import { PlainDate } from '@norbital-ai/std/date';

const ZONE = 'Asia/Singapore';
const day = new Intl.DateTimeFormat('en-CA', {
	timeZone: ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
const stamp = new Intl.DateTimeFormat('en-SG', {
	timeZone: ZONE,
	dateStyle: 'medium',
	timeStyle: 'short'
});
const time = new Intl.DateTimeFormat('en-SG', {
	timeZone: ZONE,
	hour: 'numeric',
	minute: '2-digit'
});
const weekday = new Intl.DateTimeFormat('en-SG', {
	timeZone: ZONE,
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});

/** The Singapore calendar day of an instant, `YYYY-MM-DD`. */
export const singaporeDay = (at: Date | string): PlainDate => PlainDate(day.format(new Date(at)));
/** A typed day (`<input type="date">`, a URL): the calendar date, or `null` when it is not one. */
export function dayOf(text: string | null): PlainDate | null {
	try {
		return text === null ? null : PlainDate(text);
	} catch {
		return null;
	}
}
/** An instant as a Singapore reader says it; `fallback` when there is none. */
export const singaporeInstant = (at: string | null | undefined, fallback = '—'): string =>
	at == null || Number.isNaN(Date.parse(at)) ? fallback : stamp.format(new Date(at));
export const singaporeTime = (at: string): string => time.format(new Date(at));
export const singaporeWeekday = (at: string): string => weekday.format(new Date(at));

/** A thrown value's message: an `Error`'s own, anything else as text. */
export const getErrorMessage = (error: unknown): string =>
	String(error instanceof Error ? error.message : error);
