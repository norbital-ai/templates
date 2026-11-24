import { secrets } from '@norbital-ai/bolt';

/** Sealed OAuth client credentials for Autodesk Platform Services / Construction Cloud (ACC). */
export default secrets({
	AUTODESK_CLIENT_ID: {
		label: 'Autodesk APS Client ID',
		description: 'OAuth 2.0 Client ID from your Autodesk Platform Services application.'
	},
	AUTODESK_CLIENT_SECRET: {
		label: 'Autodesk APS Client Secret',
		description: 'OAuth 2.0 Client Secret paired with AUTODESK_CLIENT_ID.'
	}
});
