import { workspace } from '@norbital-ai/bolt';

/**
 * Company CRM workspace. Documents of the template catalogue are previewed in the browser and rendered to PDF by the
 * host when sent (`convert`); meetings and voice notes are transcribed by the host's ingest (Norbital Convert); research,
 * filing and extraction run on its AI facility.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	apps: ['crm', 'configuration'],
	ai: {},
	convert: { to: ['pdf'] }
});
