import type { Policy } from './$types.js';

/** Static worker identity: humans can inspect its outputs but cannot impersonate its writes. */
export default {
	description:
		'Touches active employments so each employment write regenerates its leave accounts and ledger inline; reads the plans, profiles and facts that arithmetic needs, plus the pay components a commuted balance arrives on.',
	grants: {
		companies: { read: {} },
		jurisdictions: { read: {} },
		employees: { read: {} },
		// The monthly touch rewrites each employment as itself; what changes is nested under it.
		employments: { read: {}, mutate: { existing: { fields: [] } } },
		employment_terms: { read: {} },
		employee_children: { read: {} },
		leave_plans: { read: {}, mutate: { existing: { fields: ['lifecycle'] } } },
		leave_types: { read: {} },
		pay_components: { read: {} },
		leave_accounts: { read: {}, mutate: { new: {}, existing: { fields: ['status'] } } },
		// A ledger line is never edited; restating a stored line by id (the complete set an employment
		// write carries) is an update that changes nothing.
		leave_entries: { read: {}, mutate: { new: {}, existing: { fields: [] } } },
		// A commute payout is raised once under its formula id; restatements change nothing.
		component_entries: { read: {}, mutate: { new: {}, existing: { fields: [] } } },
		leave_requests: { read: {} }
	},
	limits: {
		'collections.*': { window: '1 min', limit: 20_000, key: 'subject' }
	}
} satisfies Policy;
