import { policy } from '@norbital-ai/bolt';
/** What the rates fetch holds: the connected account and the daily rates it writes. */
export default policy({
	description: 'Rates fetch: save the official daily exchange rates.',
	grants: {
		sys_integration: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} }, create: {}, update: {} }
	}
});
