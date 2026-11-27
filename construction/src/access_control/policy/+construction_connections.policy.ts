import { policy } from '@norbital-ai/bolt';

/** Personal WhatsApp & email connection management and Configuration app access. */
export default policy({
	description: 'Connect personal WhatsApp and email accounts and access workspace configuration.',
	capabilities: {
		apps: ['configuration'],
		personal_connections: ['whatsapp', 'email']
	},
	grants: {}
});
