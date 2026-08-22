import { defineEnvironment } from '@norbital-ai/bolt/authoring';

/**
 * What this workspace needs from its environment.
 *
 * A declaration, never a value. Values are entered under Settings → Secrets and stored in the vault
 * behind the system database; nothing here reaches the browser, and only server-side code can read
 * a value back.
 *
 * Every entry is optional. The workspace runs with an empty vault — an address field still accepts
 * a typed address without a geocoding key, it just cannot suggest one — so each reader checks for
 * `null` and says which key is missing rather than assuming one is present.
 */
export default defineEnvironment({
	GEOCODING_API_KEY: {
		label: 'Geocoding API key',
		description:
			'Turns a typed address into coordinates for geolocation fields. Without it the address picker accepts free text but offers no suggestions.'
	},
	MAP_TILE_URL: {
		label: 'Map tile URL',
		description:
			'Tile template used to draw the static maps beside a geolocation value. Not a credential, so it carries a default.',
		secret: false,
		default: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
	},
	PAYROLL_EXPORT_SIGNING_SECRET: {
		label: 'Payroll export signing secret',
		description:
			'Signs the payment files a payroll run exports so the receiving bank can verify them. Exports are refused while it is unset.'
	}
});
