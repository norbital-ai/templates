import { policy } from '@norbital-ai/bolt';
import {
	HR_ADMIN,
	HR_APPS,
	HR_AUTOMATIONS,
	HR_ENTRIES_REVIEWED,
	MEMBER_LIMITS,
	PAYROLL_CONTROLLER
} from './grants.js';

/** HR administration. Ad hoc pay, loan instalments and payroll runs require an HR Manager's approval before creation. */
export default policy({
	description:
		'HR administration across people, contracts, the roster, leave, claims, ad hoc pay and loans; payroll runs and pay submitted here require the HR Manager’s approval before creation.',
	capabilities: { apps: [...HR_APPS] },
	automations: HR_AUTOMATIONS,
	grants: { ...HR_ADMIN, ...HR_ENTRIES_REVIEWED, ...PAYROLL_CONTROLLER },
	limits: MEMBER_LIMITS
});
