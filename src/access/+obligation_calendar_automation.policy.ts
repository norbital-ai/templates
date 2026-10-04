import { jurisdictionReadFields } from './grants.js';
import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads entities, their people, contracts and declared facts, payroll runs, payslip totals and withholdings, loans, benefit cases, fact revisions and settings versions, raises the duty instances those versions declare and a reminder for each fact owed before the next run, and closes a reminder once its fact is recorded; never fulfils, waives or deletes a declared duty.',
	grants: {
		entities: { read: true },
		employee_profiles: { read: true },
		employees: { read: true },
		payroll_runs: { read: true },
		payslips: { read: true },
		rule_sets: { read: { where: { scope: { ne: "GLOBAL" } } } },
		jurisdiction_settings: { read: { fields: jurisdictionReadFields(true, false) } },
		obligations: { read: true, create: true, update:{where:{duty_code:{eq:'FACT_OWED'}},fields:['state','fulfilled_on']}, actions:['raise_calendar'] }
	},
	limits: AUTOMATION_LIMITS
});
