import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads jurisdiction settings versions and their statutory rows, and proposes a draft new version carrying the changes its research reports; never seals, edits or deletes anything.',
	grants: {
		jurisdiction_settings: { read: true, create: true },
		statutory_contributions: { read: true, create: true },
		leave_catalogue: { read: true, create: true },
		loan_catalogue: { read: true, create: true },
		claim_catalogue: { read: true, create: true },
		adhoc_catalogue: { read: true, create: true },
		allowance_catalogue: { read: true, create: true }
	},
	// each lineage's research call reads official pages itself
	capabilities: { tools: ['browser_navigate', 'browser_snapshot', 'browser_act'] },
	limits: AUTOMATION_LIMITS
});
