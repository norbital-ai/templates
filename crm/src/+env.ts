import { defineEnvironment } from '@norbital-ai/bolt/authoring';

/**
 * Names only — values are pasted in Settings → Integrations and are always optional.
 * An `{ env: 'NAME' }` reference must name a private key declared here.
 */
export default defineEnvironment({
	EXTERNAL_SYSTEM_TOKEN: {
		description: 'Bearer token for the external system of record reached by the erp integration.'
	}
});
