/**
 * Eligibility.
 *
 * `pay_components.eligibility` and `leave_types.eligibility` are rule lists: **all** must match, and
 * an empty list means everyone. An ineligible component produces nothing at all — no line, no feed
 * into a base, no zero row. That is what keeps `ot_eligible ? … : 0` out of formulas, and it is why
 * a manager simply has no overtime line rather than an overtime line of zero.
 */

import { Schema } from 'effect';
import type { WorkspaceRow } from '../$types.js';

type EligibilityRules = NonNullable<WorkspaceRow<'pay_components'>['eligibility']>;

/** The one employment's facts an eligibility rule list is answered against. */
const EligibilitySubjectSchema = Schema.Struct({
	employment_type: Schema.NullOr(Schema.String),
	work_classification: Schema.NullOr(Schema.String),
	service_months: Schema.Number,
	gender: Schema.NullOr(Schema.String),
	department: Schema.NullOr(Schema.String),
	payroll_group: Schema.NullOr(Schema.String)
});
export type EligibilitySubject = Schema.Schema.Type<typeof EligibilitySubjectSchema>;

function includes(list: readonly string[], value: string | null): boolean {
	return value != null && list.includes(value);
}

/** Whether every rule matches. */
export function isEligible(rules: EligibilityRules | null, subject: EligibilitySubject): boolean {
	if (rules == null || rules.length === 0) return true;
	return rules.every((rule: EligibilityRules[number]) => {
		switch (rule.field) {
			case 'EMPLOYMENT_TYPE':
				return includes(rule.in, subject.employment_type);
			case 'WORK_CLASSIFICATION':
				return includes(rule.in, subject.work_classification);
			case 'SERVICE_MONTHS':
				return (
					subject.service_months >= rule.from &&
					(rule.to == null || subject.service_months < rule.to)
				);
			case 'GENDER':
				return includes(rule.in, subject.gender);
			case 'DEPARTMENT':
				return includes(rule.in, subject.department);
			case 'PAYROLL_GROUP':
				return includes(rule.in, subject.payroll_group);
		}
		return false;
	});
}
