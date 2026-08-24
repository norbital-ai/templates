import type { Policy } from './$types.js';

/**
 * The weekly statutory research worker's discovery authority, held by no human team.
 *
 * Statutory configuration and employment facts are read-only here. A discovered deterministic
 * transition is delegated to `apply_statutory_successor`, whose separate static identity holds the
 * narrowly field-masked, HR-approved write grants. Web or model output can therefore recommend a
 * review but cannot rewrite the tables payroll calculates from.
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
			read: {}
		},
		statutory_profile_drift_logs: {
			create: {},
			update: {}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' }
	}
} satisfies Policy;
