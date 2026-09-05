import type { Policy } from './$types.js';

/** Static worker identity: humans can inspect its outputs but cannot impersonate its writes. */
export default {
	description:
		'Compiles approved statutory profiles and company leave plans into sealed accounts, and posts request, adjustment, accrual, carry and expiry movements.',
	grants: {
		companies: { read: {} },
		jurisdictions: { read: {} },
		employees: { read: {} },
		employments: { read: {} },
		employment_terms: { read: {} },
		employee_children: { read: {} },
		leave_plans: { read: {}, mutate: { existing: { fields: ['lifecycle'] } } },
		leave_types: { read: {} },
		leave_accounts: { read: {}, mutate: { new: {}, existing: { fields: ['status'] } } },
		leave_entries: { read: {}, mutate: { new: {} } },
		leave_requests: { read: {} }
	},
	limits: {
		'collections.*': { window: '1 min', limit: 20_000, key: 'subject' }
	}
} satisfies Policy;
