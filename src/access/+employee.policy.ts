import { CLAIM_APPROVAL, LEAVE_APPROVAL } from './grants.js';
import { jurisdictionReadFields } from './grants.js';
import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS, OWN, OWN_EMPLOYEE, OWN_EMPLOYMENT, WORK_DAY_ATTENDANCE_FIELDS, WORK_DAY_CREATE_APPROVAL, WORK_DAY_UPDATE_APPROVAL } from './grants.js';

/**
 * Self-service. Every personal read is scoped to the member's own employee row by email. A loan is read with its
 * schedule through the loan, not the repayments collection.
 */
export default policy({
	description: 'Employee self-service access to profile, time, requests, loans, and payslips.',
	capabilities: { apps: [] },
	automations: ['behaviour_catalog_events'],
	grants: {
  catalogue_entries: {
   queries: ['leave_summary','preview_leave'],
   read: { where: { ...OWN, source_kind: { in: ['claim_requests', 'adhoc_requests', 'loans', 'leave_entries'] } } },
   create: { where: { or: [{ ...OWN, source_kind: { eq: 'claim_requests' }, catalog: { eq: 'CLAIM' } }, { ...OWN, source_kind: { eq: 'leave_entries' }, catalog: { eq: 'LEAVE' }, activity: { eq: 'TIME_OFF' } }] }, fields: ['source_basis', 'company_id', 'employment_id', 'catalog', 'catalogue_id', 'reference', 'occurred_on', 'values', 'input_proofs', 'input_files'], approval: [
    { ...CLAIM_APPROVAL, match: { record: { catalog: { eq: 'CLAIM' } } } },
    { ...LEAVE_APPROVAL, match: { record: { catalog: { eq: 'LEAVE' }, activity: { eq: 'TIME_OFF' } } } }
   ] }
  },
		employees: { read: OWN_EMPLOYEE },
		employee_profiles: { read: OWN_EMPLOYMENT },
		roster_entries: {
			read: OWN,
			// their own attendance, never the schedule
					},
		payslips: { read: OWN },
		payroll_runs: {
			read: {
				where: { company_id: { is: { employee_profiles: { some: OWN_EMPLOYMENT } } } },
				fields: ['company_id', 'period', 'attendance_from', 'attendance_to']
			}
		},
		entities: { read: true },
		holidays: { read: true },
		claim_catalogue: { read: true },
		adhoc_catalogue: { read: true },
		work_catalogue: { read: true },
		allowance_catalogue: { read: true },
		loan_catalogue: { read: true },
		leave_catalogue: { read: true },
		rule_sets: { read: { where: { scope: { ne: "GLOBAL" } } } },
		jurisdiction_settings: { read: { fields: jurisdictionReadFields(true, false) } },
		statutory_contributions: { read: true }
	},
	limits: MEMBER_LIMITS
});
