import type { Policy } from './$types.js';

/**
 * The statutory drift automation's authority, held by no human team.
 *
 * It reads every settings version and its rows, and creates one draft version at a time with the
 * rows nested under it. It holds no update, no delete and no seal: a sealed version is out of its
 * reach structurally, and the draft it proposes is HR's to edit, seal or delete.
 */
export default {
	description:
		'Reads jurisdiction settings versions and their statutory rows, and proposes a draft new version carrying the rows an official page contradicts; never seals, edits or deletes anything.',
	grants: {
		jurisdiction_settings: { read: {}, mutate: { new: {} } },
		statutory_contributions: { read: {}, mutate: { new: {} } },
		contribution_rates: { read: {}, mutate: { new: {} } },
		leave_catalogue: { read: {}, mutate: { new: {} } },
		component_catalogue: { read: {}, mutate: { new: {} } },
		company_holidays: { read: {}, mutate: { new: {} } }
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' }
	}
} satisfies Policy;
