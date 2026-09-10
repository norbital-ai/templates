import { defineEnvironment } from '@norbital-ai/bolt/authoring';

/**
 * What this workspace needs from its environment.
 *
 * A declaration, never a value. Values are entered under Settings → Secrets and stored in the vault
 * behind the system database; nothing here reaches the browser, and only server-side code can read
 * a value back.
 *
 * Every entry is optional. The workspace runs with an empty vault, so each reader checks for `null`
 * and says which key is missing rather than assuming one is present.
 */
export default defineEnvironment({
	GOOGLE_CALENDAR_API_KEY: {
		label: 'Google Calendar API key',
		description:
			'Reads each entity’s configured public holiday calendar through the managed Google connection. Imports are refused while this key is unset.'
	}
});
