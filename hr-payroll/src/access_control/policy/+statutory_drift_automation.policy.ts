import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS, DRAFT_VERSION, JURISDICTION_READ } from './grants.js';

export default policy({
	description:
		'Reads sealed jurisdiction versions and their official sources, then creates an unsealed cloned draft when research finds a change. It cannot seal or void a version.',
	grants: {
		...JURISDICTION_READ,
		jurisdiction_settings: { read: true, create: DRAFT_VERSION }
	},
	automations: ['statutory_lineage'],
	capabilities: { tools: ['browser_navigate', 'browser_snapshot', 'browser_act'] },
	limits: AUTOMATION_LIMITS
});
