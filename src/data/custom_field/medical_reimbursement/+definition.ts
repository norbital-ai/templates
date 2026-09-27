import { customField } from '@norbital-ai/bolt';
import { isCalendarDate } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'The treatment, patient, relationship and practitioner evidence for a medical expense claimed from an employer. The due date is when reimbursement becomes payable, not the expense date.',
	shape: {
		kind: 'object',
		fields: {
			due_on: { kind: 'text' },
			amount_incurred: { kind: 'number' },
			patient: {
				kind: 'enum',
				values: [
					'EMPLOYEE',
					'SPOUSE',
					'NATURAL_CHILD',
					'STEPCHILD',
					'ADOPTED_CHILD',
					'GUARDIANSHIP_CHILD',
					'FOSTER_CHILD',
					'OTHER'
				]
			},
			relationship_from: { kind: 'text', optional: true },
			relationship_through: { kind: 'text', optional: true },
			relationship_recognised: { kind: 'bool' },
			relationship_reference: { kind: 'text' },
			treatment: { kind: 'enum', values: ['MEDICAL', 'DENTAL', 'DENTAL_HYGIENE', 'TCM'] },
			treatment_received: { kind: 'bool' },
			treatment_necessary: { kind: 'bool' },
			solely_aesthetic: { kind: 'bool' },
			treatment_country: { kind: 'text' },
			practitioner_qualified: { kind: 'bool' },
			practitioner_reference: { kind: 'text' }
		}
	}
});
export default f;

f.validate((details) => {
	if (!isCalendarDate(details.due_on)) return 'Enter a valid reimbursement due date.';
	if (!Number.isFinite(details.amount_incurred) || details.amount_incurred <= 0)
		return 'Enter the positive amount actually incurred.';
	if (
		(details.relationship_from != null && !isCalendarDate(details.relationship_from)) ||
		(details.relationship_through != null && !isCalendarDate(details.relationship_through)) ||
		(details.relationship_from != null &&
			details.relationship_through != null &&
			details.relationship_through < details.relationship_from)
	)
		return 'Enter a valid patient relationship period.';
	if (details.patient !== 'EMPLOYEE' && details.relationship_from == null)
		return 'Enter when the patient relationship began.';
	if (details.treatment_country.trim() === '' || details.practitioner_reference.trim() === '')
		return 'Identify the treatment country and practitioner qualification evidence.';
	if (details.patient !== 'EMPLOYEE' && details.relationship_reference.trim() === '')
		return 'Identify the patient relationship evidence.';
});
