import { customField } from '@norbital-ai/bolt';
import { isCalendarDate } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'The child facts of one employment contract: birth date, relationship and legal span. Append-only — a wrong fact is closed by its effective range, never rewritten — so statutory leave that scales by children is reconstructable on any date.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				child_birthdate: { kind: 'text' },
				child_deathdate: { kind: 'text', optional: true },
				child_confinement_date: { kind: 'text', optional: true },
				estimated_delivery_date: { kind: 'text', optional: true },
				adoption_eligibility_date: { kind: 'text', optional: true },
				relationship: { kind: 'enum', values: ['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD'] },
				effective_range: { kind: 'period', of: 'instant', optional: true },
				citizenship: { kind: 'text', optional: true },
				shared_parental_weeks: { kind: 'int', min: 0, optional: true },
				prior_employment_days: { kind: 'int', min: 0, optional: true },
				prior_childcare_days: { kind: 'int', min: 0, optional: true },
				prior_extended_childcare_days: { kind: 'int', min: 0, optional: true },
				prior_infant_care_days: { kind: 'int', min: 0, optional: true },
				relief_class: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;
f.validate((children) => {
	if (!children.every((child) => isCalendarDate(child.child_birthdate)))
		return 'Enter a valid child birth date.';
	if (
		!children.every(
			(child) =>
				child.child_deathdate == null ||
				(isCalendarDate(child.child_deathdate) && child.child_deathdate >= child.child_birthdate)
		)
	)
		return 'A child death date must be a valid date on or after birth.';
	if (
		!children.every(
			(child) =>
				child.child_confinement_date == null ||
				(isCalendarDate(child.child_confinement_date) &&
					child.child_confinement_date <= child.child_birthdate)
		)
	)
		return 'A confinement date must be a valid date on or before the child’s birth.';
	if (
		!children.every(
			(child) =>
				(child.estimated_delivery_date == null || isCalendarDate(child.estimated_delivery_date)) &&
				(child.adoption_eligibility_date == null || isCalendarDate(child.adoption_eligibility_date))
		)
	)
		return 'An estimated delivery or adoption eligibility date must be a valid date.';
});
