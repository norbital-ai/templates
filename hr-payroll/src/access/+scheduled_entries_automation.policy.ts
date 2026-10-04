import { jurisdictionReadFields } from './grants.js';
import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Raises the scheduled mandatory payments as held requests (ad hoc and leave-year-end ENCASHMENT) for the HR Manager, records each occurrence in the obligation ledger, and fulfils an occurrence once a paid payslip settled it. Reads what the person context and leave balances need; never edits or deletes an entry.',
	grants: {
		entities: { read: true },
		employee_profiles: { read: true },
		employees: { read: true },
		statutory_contributions: { read: true },
		rule_sets: { read: { where: { scope: { ne: "GLOBAL" } } } },
		jurisdiction_settings: { read: { fields: jurisdictionReadFields(true, true) } },
		holidays: { read: true },
		roster_entries: { read: true },
		payroll_runs: { read: true },
		payslips: { read: true },
		adhoc_catalogue: { read: true },
        catalogue_entries:{read:true,create:{fields:['source_basis','company_id','employment_id','catalog','catalogue_id','reference','occurred_on','values','input_proofs','input_files']}},
		leave_catalogue: { read: true },
		obligations: {
			read: true, create:true, update:{fields:['state','fulfilled_on']}
		}
	},
	limits: AUTOMATION_LIMITS
});
