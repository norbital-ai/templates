import { workspace } from '@norbital-ai/bolt';

/**
 * Project delivery. The Transcriber fetches its speech and speaker model weights from Hugging Face on first use
 * (`src/lib/transcriber.worker.js`); nothing else leaves the browser.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en',
	apps: ['crm', 'sow', 'transcriber'],
	csp: {
		connect: [
			'https://cdn.jsdelivr.net',
			'https://huggingface.co',
			'https://cdn-lfs.huggingface.co',
			'https://cas-bridge.xethub.hf.co'
		]
	}
});
