import { defineEnvironment } from '@norbital-ai/bolt/authoring';

/**
 * Names only — values are pasted in Settings → Integrations and are always optional.
 * An `{ env: 'NAME' }` reference must name a private key declared here.
 */
export default defineEnvironment({
	DISPATCH_WEBHOOK_SECRET: {
		description: 'HMAC secret for inbound job updates from the dispatch system.'
	}
});
