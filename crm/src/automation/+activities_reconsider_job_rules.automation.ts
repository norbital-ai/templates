import { automation } from '@norbital-ai/bolt';
import { RECONSIDER_JOB_RULES_INPUT, reconsiderJobRules } from '../lib/activity-commands.js';

export default automation({
	description: 'Reconsiders captured messages after job capture rules change.',
	input: RECONSIDER_JOB_RULES_INPUT,
	policies: ['hq_automation'],
	agent: 'never',
	run: function* (input, ctx) {
		yield* reconsiderJobRules(input, ctx);
	}
});
