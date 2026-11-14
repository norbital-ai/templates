import { policy } from '@norbital-ai/bolt';
import { READ_ALL, CONFIGURATION } from './grants.js';

export default policy({
	description:
		'Canonical jurisdiction configuration research and cloning. This policy is held only by declared system automations.',
	grants: { ...READ_ALL, ...CONFIGURATION },
	capabilities: {
		tools: ['web_search', 'browser_navigate', 'browser_snapshot', 'browser_act']
	}
});
