import { policy } from '@norbital-ai/bolt';
import {
	HR_ADMIN,
	HR_APPS,
	HR_ENTRIES_DIRECT,
	MEMBER_LIMITS,
	PAYROLL_AUTHORITY
} from './grants.js';

/** The top rank: every HR and payroll authority, and the final approver of every route. */
export default policy({
	description: 'Every HR and payroll authority; the final approver on every review route.',
	capabilities: { apps: [...HR_APPS] },
	automations: ['statutory_drift'],
	grants: { ...HR_ADMIN, ...HR_ENTRIES_DIRECT, ...PAYROLL_AUTHORITY },
	limits: MEMBER_LIMITS
});
