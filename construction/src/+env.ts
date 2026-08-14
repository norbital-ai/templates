import { defineEnvVars } from '@norbital-ai/pod/authoring';

/**
 * Names only — values are pasted in Settings → Integrations and are always optional.
 * An `{ env: 'NAME' }` reference must name a private key declared here.
 */
export const variables = defineEnvVars({
	REPORTS_WEBHOOK_SECRET: {
		description: 'HMAC secret for inbound RFI deliveries from the external reports system.'
	}
});
