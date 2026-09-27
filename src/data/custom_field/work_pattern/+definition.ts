import { customField } from '@norbital-ai/bolt';
import { isSettledId } from '../../../lib/iso-day.js';

// A day cycle or a declared week with no tag between them: both optional here, the check admits exactly one.
const f = customField({
	description:
		'The employment schedule term: a repeating day cycle of roster codes, anchored at the pattern row’s effective start, or a declared week (days and paid minutes) where no cycle can be generated. The days a week a contract works are read from here.',
	shape: {
		kind: 'object',
		fields: {
			days: {
				kind: 'list',
				of: { kind: 'object', fields: { roster_code_id: { kind: 'text' } } },
				optional: true
			},
			expectation: {
				kind: 'object',
				optional: true,
				fields: {
					days_per_week: { kind: 'number', max: 7 },
					minimum_paid_minutes_per_week: { kind: 'int', min: 1, optional: true },
					maximum_paid_minutes_per_week: { kind: 'int', min: 1, optional: true }
				}
			}
		}
	}
});
export default f;
f.validate(({ days, expectation }) => {
	if (days != null)
		return expectation == null &&
			days.length > 0 &&
			days.every((day) => isSettledId(day.roster_code_id))
			? undefined
			: 'A cycle lists at least one roster code, and no declared week.';
	if (expectation == null) return 'A pattern is a day cycle or a declared week.';
	const { days_per_week, minimum_paid_minutes_per_week, maximum_paid_minutes_per_week } =
		expectation;
	return days_per_week > 0 &&
		days_per_week <= 7 &&
		[minimum_paid_minutes_per_week, maximum_paid_minutes_per_week].every(
			(value) => value == null || (Number.isInteger(value) && value > 0)
		)
		? undefined
		: 'A declared week works 1–7 days, with whole positive paid minutes.';
});
