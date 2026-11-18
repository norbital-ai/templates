import { automation } from '@norbital-ai/bolt';
import { RETRY_ROUTING_INPUT, retryRouting } from '../lib/activity-commands.js';

export default automation({
	description: 'Reconsiders a deterministically filtered message after routing rules change.',
	input: RETRY_ROUTING_INPUT,
	policies: ['hq_automation'],
	agent: 'never',
	run: function* (input, ctx) {
		yield* retryRouting(input, ctx);
	}
});
