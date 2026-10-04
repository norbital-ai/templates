import { workspace } from '@norbital-ai/bolt';

/**
 * Multi-country HR and payroll. Money is stated in each row's own currency (a jurisdiction settings version names
 * it), so the workspace sets no default currency. Timezone and locale belong to the client; the server stores UTC.
 */
export default workspace({
	// statutory drift researches on the strong class; the host maps each class to a model
	ai: { models: ['default', 'strong'], default: 'default' },
	env: {
		GOOGLE_CALENDAR_API_KEY: {
			label: 'Google Calendar API key',
			description:
				'Reads each entity’s configured public holiday calendar for the holiday import. Imports are refused while this key is unset.'
		},
		GOOGLE_CALENDAR_BASE_URL: {
			label: 'Google Calendar API base URL',
			secret: false,
			default: 'https://www.googleapis.com/calendar/v3/'
		}
	}
});
