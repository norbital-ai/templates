import { approveBy } from '@norbital-ai/bolt/authoring';
import type { Policy } from './$types.js';

/** Both coordinates resolve to this one concrete review route for the atomic transition graph. */
const statutoryChangeApproval = {
	flow: () => approveBy('HR Manager'),
	superceded_by: ['Senior Management']
} as const;

/**
 * The authority of one deterministic statutory-successor worker, held by no human team.
 *
 * It may inspect only the contribution and employment-fact records needed to validate its proposal.
 * Its create is restricted to the successor fields and its update to the predecessor's effective
 * range. Both are a flat denial until the same HR Manager flow approves the complete graph.
 */
export default {
	description:
		'Validates and submits one atomic statutory-fact successor transition for HR Manager approval.',
	grants: {
		statutory_contributions: {
			read: {}
		},
		employment_statutory_facts: {
			read: {},
			create: {
				fields: [
					'employment_id',
					'statutory_contribution_id',
					'status',
					'effective_range',
					'supersedes_fact_id'
				],
				approval: statutoryChangeApproval
			},
			update: {
				fields: ['effective_range'],
				approval: statutoryChangeApproval
			}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 120, key: 'subject' }
	}
} satisfies Policy;
