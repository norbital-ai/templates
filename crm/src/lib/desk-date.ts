const DESK_TIME_ZONE = 'Asia/Singapore';

/** `en-CA` is the locale whose numeric date *is* `YYYY-MM-DD`, so no part has to be reassembled. */
const deskCalendarDate = new Intl.DateTimeFormat('en-CA', {
	timeZone: DESK_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** The desk's calendar day, so a document number can be assigned by the day it is written. */
export function deskToday(now: Date): string {
	return deskCalendarDate.format(now);
}
