import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A Philippine maternity application and its dated contingency. SSS award and DOLE exemption are evidenced facts; employee payments and SSS reimbursements are separate movements.',
	icon: 'lucide:baby',
	label: 'case_reference',
	fields: {
		case_reference: { kind: 'text' },
		application_on: { kind: 'date' },
		/** Expected delivery permits the case and thirty-day advance clock to exist before childbirth. */
		expected_delivery_on: { kind: 'date', optional: true },
		/** Actual contingency; these fields appear together after childbirth, miscarriage or ETP. */
		event_kind: {
			kind: 'enum',
			values: ['BIRTH', 'MISCARRIAGE', 'EMERGENCY_TERMINATION'],
			optional: true
		},
		event_on: { kind: 'date', optional: true },
		/** Declare this event's solo-parent class; a current employee flag is not historical proof. */
		solo_parent_claimed: { kind: 'bool', optional: true },
		solo_parent_document_kind: {
			kind: 'enum',
			values: ['SOLO_PARENT_ID', 'ELIGIBILITY_CERTIFICATE'],
			optional: true
		},
		solo_parent_document_issued_on: { kind: 'date', optional: true },
		solo_parent_document_valid_from: { kind: 'date', optional: true },
		solo_parent_document_valid_through: { kind: 'date', optional: true },
		solo_parent_document_reference: { kind: 'text', optional: true },
		solo_parent_document_issuer_lgu: { kind: 'text', optional: true },
		solo_parent_document_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		solo_parent_social_worker_signature_seen: { kind: 'bool', optional: true },
		solo_parent_mayor_signature_seen: { kind: 'bool', optional: true },
		solo_parent_certificate_details_checked: { kind: 'bool', optional: true },
		solo_parent_first_time: { kind: 'bool', optional: true },
		/** The planned continuous leave span, not a substitute for approved cutoff-split leave entries. */
		leave_from: { kind: 'date', optional: true },
		leave_through: { kind: 'date', optional: true },
		sss_notified_on: { kind: 'date', optional: true },
		sss_notification_reference: { kind: 'text', optional: true },
		/** Actual SSS determination, which may differ from the local candidate calculation. */
		sss_award_amount: { kind: 'decimal', scale: 2, optional: true },
		sss_awarded_on: { kind: 'date', optional: true },
		sss_award_reference: { kind: 'text', optional: true },
		sss_award_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** A claimed category needs DOLE approval evidence; it does not auto-waive differential. */
		exemption_kind: {
			kind: 'enum',
			values: ['DISTRESSED', 'SMALL_RETAIL_SERVICE', 'MICRO_ENTERPRISE', 'EQUAL_OR_BETTER'],
			optional: true
		},
		exemption_effective_range: { kind: 'period', of: 'date', optional: true },
		exemption_approved_on: { kind: 'date', optional: true },
		exemption_reference: { kind: 'text', optional: true },
		exemption_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	unique: [
		{ fields: ['employee_id', 'case_reference'] },
		{ fields: ['employee_id', 'event_kind', 'event_on'] }
	],
	index: [
		['employee_id', 'event_on'],
		['employment_id', 'application_on']
	],
	search: { text: ['case_reference', 'sss_award_reference', 'exemption_reference'] }
});
