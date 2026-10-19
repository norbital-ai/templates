import { policy } from '@norbital-ai/bolt';
import {
	HR_ADMIN,
	HR_APPS,
	HR_ENTRIES_DIRECT,
	MEMBER_LIMITS,
	PAYROLL_AUTHORITY
} from './grants.js';

/** Payroll authority: everything HR administers, plus runs without review, re-runs and payment. */
export default policy({
	description:
		'HR administration plus payroll authority: creates, deletes and pays payroll runs without review.',
	capabilities: { apps: [...HR_APPS] },
	automations: ['statutory_drift'],
	grants: { ...HR_ADMIN, ...HR_ENTRIES_DIRECT, ...PAYROLL_AUTHORITY },
	limits: MEMBER_LIMITS
});
