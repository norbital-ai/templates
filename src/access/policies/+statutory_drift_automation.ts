import { approveBy } from '@norbital-ai/bolt/authoring';
import type { Policy } from './$types.js';

/** The direct successor `mutate.new` and hook-staged predecessor close share one review route. */
const statutoryChangeApproval = {
	flow: () => approveBy('HR Manager'),
	superceded_by: ['Senior Management']
} as const;

/**
 * The weekly statutory research worker's discovery authority, held by no human team.
 *
 * The worker can propose an evidence-backed statutory successor and deterministic employment
 * corrections. Both remain pending HR Manager approval; existing law cannot be overwritten.
 */
export default {
	description:
		'Reads statutory and employment snapshots, appends deterministic successor facts, and proposes statutory successors and research sources from official pages, each behind HR approval.',
	grants: {
		statutory_research_sources: {
			read: {},
			mutate: { new: { approval: statutoryChangeApproval } }
		},
		jurisdictions: {
			read: {},
			mutate: { new: { approval: statutoryChangeApproval } }
		},
		statutory_contributions: {
			read: {}
		},
		contribution_rates: {
			read: {}
		},
		companies: {
			read: {}
		},
		employments: {
			read: {}
		},
		employment_statutory_facts: {
			read: {},
			mutate: {
				new: {
					fields: [
						'employment_id',
						'statutory_contribution_id',
						'status',
						'effective_range',
						'supersedes_fact_id'
					],
					approval: statutoryChangeApproval
				},
				existing: {
					fields: ['effective_range'],
					approval: statutoryChangeApproval
				}
			}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' }
	}
} satisfies Policy;
