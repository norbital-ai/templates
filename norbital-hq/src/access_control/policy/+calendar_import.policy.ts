import { policy } from '@norbital-ai/bolt';

/** The `google_calendar` read: file each member's calendar events as entries, naming their account and owner. */
export default policy({
	description: 'Files the events read from members’ Google Calendars as calendar entries.',
	grants: {
		calendar_entries: { outputs: { default: {} }, create: {}, update: {} },
		// an entry names its account and whose calendar it is: whoever writes a link must read it
		sys_integration: { outputs: { default: {} } },
		sys_user: { outputs: { default: {} } }
	}
});
