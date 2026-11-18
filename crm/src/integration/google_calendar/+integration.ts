import { integration } from '@norbital-ai/bolt';

/**
 * A member's own Google Calendar account (one per member: `owner` is whose calendar it is). Its calendars sync into
 * `calendar_entries` (`calendar_entries.syncs.google_calendar`, one cursor per configured calendar) and HQ meetings
 * write back to it (`activities.syncs.google_calendar`).
 */
export default integration('google_calendar', {
	description: 'Personal Google calendars and every source appointment.',
	driver: 'calendar',
	configuration: { calendars: { kind: 'text', many: true, default: ['primary'] } }
});
