import { policy } from '@norbital-ai/bolt';
import {
	HR_ADMIN,
	HR_APPS,
	HR_ENTRIES_REVIEWED,
	MEMBER_LIMITS,
	PAYROLL_CONTROLLER
} from './grants.js';

/** HR administration. Ad hoc pay, loan instalments and payroll runs this rank raises are held for the HR Manager. */
export default policy({
	description:
		'HR administration across people, contracts, the roster, leave, claims, ad hoc pay and loans; payroll runs and pay raised here are held for the HR Manager.',
	capabilities: { apps: [...HR_APPS] },
	automations: ['statutory_drift'],
	grants: { ...HR_ADMIN, ...HR_ENTRIES_REVIEWED, ...PAYROLL_CONTROLLER },
	limits: MEMBER_LIMITS
});
