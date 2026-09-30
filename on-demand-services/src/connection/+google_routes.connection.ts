import { connection } from '@norbital-ai/bolt';

/** Google Maps' Routes API: drive times for matching (`check_drives`) and the live ETA check (`eta_watch`). */
export default connection({
	baseUrl: 'GOOGLE_ROUTES_BASE_URL',
	auth: { header: { name: 'X-Goog-Api-Key', value: 'GOOGLE_MAPS_API_KEY' } }
});
