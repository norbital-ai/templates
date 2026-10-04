/**
 * The literals the policies share: self-service scopes, approval routes and the work-day field masks.
 *
 * A policy states its whole authority in its own file; this module only names the pieces several of them repeat,
 * so a route or a scope is written once. Every delete refusal that reads other rows lives in its collection's
 * transform (`delete: { transform: true }`); what a grant can say about the row itself is a `Where` here.
 */

/** The signed-in member's own employee row: the email compares case-folded. */
export const OWN_EMPLOYEE = { email: { eq: { actor: 'email' } } } as const;
/** An employment whose employee is the signed-in member. */
export const OWN_EMPLOYMENT = { employee_id: { is: OWN_EMPLOYEE } } as const;
/** A row about one of the member's own employee_profiles. */
export const OWN = { employment_id: { is: OWN_EMPLOYMENT } } as const;

/** A source no payslip settled; a settled one is released by deleting that draft payslip, never directly. */
export const UNPINNED = { payslip_id: { isNull: true } } as const;
/** A version still a draft: never sealed, never voided. */
export const DRAFT_VERSION = { sealed_at: { isNull: true }, voided_at: { isNull: true } } as const;
/** A catalogue row of a draft version; a sealed version's rows go only with a draft. */
export const DRAFT_SETTINGS_ROW = { settings_id: { is: { sealed_at: { isNull: true } } } } as const;
/** A payslip nobody was paid on; the later-sibling half of the rule is the payslips transform's delete guard. */
export const UNPAID_PAYSLIP = {
	status: { ne: 'PAID' },
	paid_at: { isNull: true },
	funding_received: { eq: 0 }
} as const;
/** A work day with no plan and no pin: what a rank that records attendance, and not the schedule, may delete. */
export const ATTENDANCE_ONLY_DAY = {
	shift_definition_id: { isNull: true },
	payslip_id: { isNull: true }
} as const;

/** Which person, which day, and the clock: what a rank that records attendance may write on a new day. */
export const WORK_DAY_ATTENDANCE_FIELDS = [
	'employment_id',
	'work_date',
	'worked_intervals'
] as const;
/** Both sides of the day: the plan (roster code, overtime and incentive hours) and the clock. */
export const WORK_DAY_FULL_FIELDS = [
	'employment_id',
	'work_date',
	'shift_definition_id',
	'approved_overtime_hours',
	'overtime_consented_at',
	'incentive_hours',
	'worked_intervals',
	'facts'
] as const;

const REVIEWERS = ['HR Manager', 'Senior Management'] as const;

/** A new day is reviewed when it arrives carrying attendance (`[]` is a claim too; null is a plan only). */
export const WORK_DAY_CREATE_APPROVAL = {
	match: { record: { worked_intervals: { isNull: false } } },
	steps: [['L1 Manager', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** An edit is reviewed when it touches the clock, not when it only moves the plan. */
export const WORK_DAY_UPDATE_APPROVAL = {
	match: { changed: ['worked_intervals'] },
	steps: [['L1 Manager', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;

/** A person's time off: the direct manager, or HR. */
export const LEAVE_APPROVAL = {
	steps: [['L1 Manager', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** HR's leave entries: time off routes to the direct manager; with `manual`, every other activity to the HR Manager. */
export const HR_LEAVE_TIME_OFF = {
	...LEAVE_APPROVAL,
	match: { record: { activity: { eq: 'TIME_OFF' } } }
} as const;
export const HR_LEAVE_MANUAL = {
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;

/** A claim a person raises about themselves. */
export const CLAIM_APPROVAL = {
	steps: [['HQ Payroll HR', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** The separation payment off-boarding raises for a leaver. */
export const SEPARATION_APPROVAL = {
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** A payroll run an HR controller creates is held for the HR Manager. */
export const CONTROLLER_RUN_APPROVAL = {
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: ['Senior Management']
} as const;

/** Sealing and voiding are the reviewed acts; editing a draft is not. */
export const SEAL_CREATE_APPROVAL = {
	match: {
		or: [{ record: { sealed_at: { isNull: false } } }, { record: { voided_at: { isNull: false } } }]
	},
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: ['Senior Management']
} as const;
export const SEAL_UPDATE_APPROVAL = {
	match: {
		or: [
			{ changed: ['sealed_at'], record: { sealed_at: { isNull: false } } },
			{ changed: ['voided_at'], record: { voided_at: { isNull: false } } }
		]
	},
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: ['Senior Management']
} as const;

/** Every app of the HR controller group (a policy lists apps by name). */
export const HR_CONTROLLER_APPS = ['hr_controller/entities', 'hr_controller/people'] as const;

/** Today's per-member budget: 600 collection calls a minute, 100 agent turns an hour. */
export const MEMBER_LIMITS = { act: '600/min', read: '600/min', agent: '100/h' } as const;
/** An automation's budget. */
export const AUTOMATION_LIMITS = { act: '600/min', read: '600/min' } as const;

import jurisdictionModel from '../data/model/jurisdiction/jurisdiction_settings/+model.ts';
import relationships from '../data/+relationship.ts';
import type { ReadField } from '@norbital-ai/bolt';
/** Configuration moved under the jurisdiction retains each policy's original field visibility. */
export function jurisdictionReadFields(referenceRows: boolean, assessmentPolicies: boolean): readonly ReadField<'jurisdiction_settings'>[] {
 const excluded = new Set([...(referenceRows ? [] : ['reference_rows']), ...(assessmentPolicies ? [] : ['employer_assessment_policies'])]);
 return [...new Set(['id', 'revision', 'approval_id', 'created_at', 'updated_at', 'created_by', 'updated_by', ...Object.keys(jurisdictionModel.fields), ...Object.keys(relationships).filter(key => key.startsWith('jurisdiction_settings.')).map(key => key.slice('jurisdiction_settings.'.length))])].filter(field => !excluded.has(field)) as ReadField<'jurisdiction_settings'>[];
}
