import { integration } from '@norbital-ai/bolt';
/**
 * The Monetary Authority of Singapore's daily end-of-period exchange rates (SGD per unit; some currencies per 100),
 * published after midday on Singapore business days. Its API key stays sealed with the host.
 */
export default integration('mas_rates', {
	description: 'Official daily exchange rates from the Monetary Authority of Singapore.',
	driver: 'http',
	credential: { api_key: { kind: 'text' } },
	http: {
		base_url: 'https://eservices.mas.gov.sg/apimg-gw/server/',
		auth: { header: { name: 'keyid', value: 'api_key' } }
	}
});
