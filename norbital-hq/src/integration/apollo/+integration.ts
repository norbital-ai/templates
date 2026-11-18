import { integration } from '@norbital-ai/bolt';

/**
 * The workspace's Apollo account: `import_leads` reads its saved contacts (optionally only those under the configured
 * labels) into the lead pipeline; `research_lead` enriches what a lead lacks; `launch_cohort` pushes a cohort's sequence
 * and enrols its leads, sending from `email_account_id` (the Apollo mailbox), and `sync_cohort` reads their progress.
 * The owner pastes the API key (a master key: sequences need one) into the native connection form; it is sealed
 * host-side.
 */
export default integration('apollo', {
	description:
		'Apollo.io account: saved contacts become leads, leads are enriched, cohorts are sent its sequences.',
	driver: 'http',
	http: {
		base_url: 'https://api.apollo.io',
		auth: { header: { name: 'X-Api-Key', value: 'api_key' } }
	},
	credential: { api_key: { kind: 'text' } },
	configuration: {
		label_ids: { kind: 'text', many: true, optional: true },
		email_account_id: { kind: 'text', optional: true }
	},
	rate: '50/min',
	test: function* (ctx) {
		yield* ctx.request({ method: 'GET', path: '/api/v1/auth/health', output: { kind: 'json' } });
	}
});
