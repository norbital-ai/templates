import { Result } from 'effect';
import type { MessageKey } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import catalog from '../i18n/+messages.js';
/** Whether `key` is one of the workspace's messages, such as an enum value's `models.<model>.fields.<field>.<value>`. */
export const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(catalog, key);
/**
 * Readings of an instant in the workspace zone, which a page takes from its context (`ctx.tz`), never a zone of
 * its own. A stored value on screen is the kit's (`Show`, `format`, a record sheet's field-list `subtitle`).
 */
/** The calendar day of an instant in `zone`, `YYYY-MM-DD`. */
export const dayIn = (zone: string | undefined, at: Date | string): PlainDate =>
	PlainDate(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(at))
	);
/** A typed day (`<input type="date">`, a URL): the calendar date, or `null` when it is not one. */
export const dayOf = (text: string | null): PlainDate | null =>
	text === null ? null : Result.getOrNull(Result.try(() => PlainDate(text)));
/** A message's clock time and its day's heading, as `locale` says them in `zone`. */
export const timeIn = (zone: string | undefined, locale: string, at: string): string =>
	new Date(at).toLocaleTimeString(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' });
export const weekdayIn = (zone: string | undefined, locale: string, at: string): string =>
	new Date(at).toLocaleDateString(locale, {
		timeZone: zone,
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
/** A thrown value's message: an `Error`'s own, anything else as text. */
export const getErrorMessage = (error: unknown): string =>
	String(error instanceof Error ? error.message : error);
