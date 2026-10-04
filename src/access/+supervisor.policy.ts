import { CLAIM_APPROVAL, LEAVE_APPROVAL } from './grants.js';
import { jurisdictionReadFields } from './grants.js';
import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS, OWN, WORK_DAY_ATTENDANCE_FIELDS, WORK_DAY_CREATE_APPROVAL, WORK_DAY_UPDATE_APPROVAL } from './grants.js';

export default policy({
	description:
		'First-line supervisor: reads the team, reviews and records their attendance and leave.',
	capabilities: { apps: [] },
	automations: ['catalog_events'],
	grants: {
  catalogue_entries: {
   queries: ['leave_summary','preview_leave'],
   read: { where: { source_kind: { in: ['claim_requests', 'adhoc_requests', 'leave_entries'] } } },
   create: { where: { or: [{ ...OWN, source_kind: { eq: 'claim_requests' }, catalog: { eq: 'CLAIM' } }, { source_kind: { eq: 'leave_entries' }, catalog: { eq: 'LEAVE' }, activity: { eq: 'TIME_OFF' } }] }, fields: ['source_basis', 'company_id', 'employment_id', 'catalog', 'catalogue_id', 'reference', 'occurred_on', 'values', 'input_proofs', 'input_files'], approval: [
    { ...CLAIM_APPROVAL, match: { record: { catalog: { eq: 'CLAIM' } } } },
    { ...LEAVE_APPROVAL, match: { record: { catalog: { eq: 'LEAVE' }, activity: { eq: 'TIME_OFF' } } } }
   ] }
  },
		entities: { read: true },
		leave_catalogue: { read: true },
		holidays: { read: true },
		rule_sets: { read: { where: { scope: { ne: "GLOBAL" } } } },
		jurisdiction_settings: { read: { fields: jurisdictionReadFields(false, false) } },
		statutory_contributions: { read: true },
		employees: { read: true },
		employee_profiles: { read: true },
		payroll_runs: {
			read: { fields: ['company_id', 'period', 'attendance_from', 'attendance_to'] }
		},
		payslips: { read: OWN },
		roster_entries: {
			read: true,
			// attendance, never the schedule; every write it admits touches the clock and is reviewed
					},
		rosters: { read: true }
	},
	limits: MEMBER_LIMITS
});
