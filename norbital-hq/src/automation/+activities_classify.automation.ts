import { automation } from '@norbital-ai/bolt';
import { CLASSIFY_ACTIVITY_INPUT, classifyActivity } from '../lib/activity-commands.js';

export default automation({
	description: 'Applies background classification only while a message still awaits triage.',
	input: CLASSIFY_ACTIVITY_INPUT,
	policies: ['hq_automation'],
	agent: 'never',
	run: function* (input, ctx) {
		yield* classifyActivity(input, ctx);
	}
});
