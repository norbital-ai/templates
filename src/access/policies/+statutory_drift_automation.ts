import { approveBy } from '@norbital-ai/bolt/authoring';
import type { Policy } from './$types.js';

/** The direct successor create and hook-staged predecessor close share one review route. */
const statutoryChangeApproval = {
	flow: () => approveBy('HR Manager'),
	superceded_by: ['Senior Management']
} as const;

/**
 * The weekly statutory research worker's discovery authority, held by no human team.
 *
 * Statutory configuration remains read-only. A deterministic successor transition is submitted
 * directly under this identity, through narrowly field-masked create/update grants whose one
 * concrete path requires HR Manager approval. Web research output never writes law tables.
 */
export default {
	description:
		'Reads statutory and employment snapshots, appends deterministic successor facts, and records durable statutory-drift research evidence.',
	grants: {
		jurisdictions: {
			read: {}
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
		},
		statutory_profile_drift_logs: {
			read: {},
			create: {},
			update: {}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' }
	}
} satisfies Policy;
