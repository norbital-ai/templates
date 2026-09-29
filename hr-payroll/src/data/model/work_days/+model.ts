import { model } from '@norbital-ai/bolt';

/**
 * One person-day: what was PLANNED for it (`shift_definition_id`, the overtime keyed on it) and what ACTUALLY
 * happened (`worked_intervals`). Planned without actual assumes the schedule; actual without planned is an
 * unrostered day worked; `worked_intervals` null is no punch, `[]` a day read and found empty. Holidays are
 * overlaid from the entity's calendar by date, never linked.
 */
export default model({
	description:
		'One person-day: the planned shift and the actual attendance side by side. Either may be absent. Holidays are overlaid from the entity’s published calendar by date, breaks are the gaps between the day’s intervals, premium work is derived from plan, attendance, calendar and the statutory rules in force, and overtime is planned on the day: the hours within the limits and the incentive hours beyond them.',
	icon: 'lucide:calendar-clock',
	label: 'work_date',
	fields: {
		work_date: { kind: 'date' },
		/** The attendance: what was actually worked, ordered and non-overlapping. */
		worked_intervals: {
			kind: 'json',
			shape: { kind: 'list', of: { kind: 'period', of: 'instant' } },
			optional: true
		},
		/** SG EA s.88A(5): the employer's dated permission decision for an absence. */
		sg_absence_permission: { kind: 'enum', values: ['YES', 'NO'], optional: true },
		/** SG EA s.88A(5): whether a reasonable excuse was established for that absence. */
		sg_absence_reasonable_excuse: { kind: 'enum', values: ['YES', 'NO'], optional: true },
		/** The dated absence/permission/excuse decision's supporting record. */
		sg_absence_decision_reference: { kind: 'text', optional: true },
		/** A shorter-than-scheduled absence cannot be counted as a whole working day. */
		sg_partial_absence: { kind: 'bool', optional: true },
		/** Planned overtime within the statutory limits, in half-hour steps; the transform refuses more than the headroom. */
		approved_overtime_hours: { kind: 'decimal', scale: 2, min: 0, optional: true },
		/** The worker's consent to this particular overtime or holiday-work occasion (LPA ss.24–25). */
		overtime_consented_at: { kind: 'instant', optional: true },
		/** TH LPA ss.24–25: a recorded reason that dispenses with consent for this occasion. */
		th_consent_exception: {
			kind: 'enum',
			values: [
				'CONTINUOUS_DAMAGE_IF_STOPPED',
				'EMERGENCY',
				'HOLIDAY_HOTEL',
				'HOLIDAY_ENTERTAINMENT',
				'HOLIDAY_TRANSPORT',
				'HOLIDAY_FOOD_SHOP',
				'HOLIDAY_DRINK_SHOP',
				'HOLIDAY_CLUB',
				'HOLIDAY_ASSOCIATION',
				'HOLIDAY_MEDICAL_FACILITY'
			],
			optional: true
		},
		/** Document proving the continuous-work necessity, emergency or s.25 business classification. */
		th_consent_exception_reference: { kind: 'text', optional: true },
		/** TH LPA s.27: the prior agreement to split the day's one-hour rest into shorter breaks. */
		th_split_break_agreed_at: { kind: 'instant', optional: true },
		/** TH LPA s.47: the prior written Director-General permission for under-18 night work. */
		th_minor_night_permission_granted_at: { kind: 'instant', optional: true },
		th_minor_night_permission_reference: { kind: 'text', optional: true },
		/** Agreement to redistribute this normal day above eight hours (LPA s.23). */
		normal_hours_redistribution_agreed_at: { kind: 'instant', optional: true },
		/** Similar full-time employee's normal hours on this day, overriding the terms' usual day. */
		comparable_full_time_daily_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0.01,
			max: 24,
			optional: true
		},
		/** Planned overtime beyond the limits, priced on the INCENTIVE line. */
		incentive_hours: { kind: 'decimal', scale: 2, min: 0, optional: true },
		/** Where the day was worked, a province or `province/district` (TH Notice 14 cl.20); overrides the terms' worksite for this day. */
		worksite: { kind: 'text', optional: true },
		/** Units completed on a piece-rate workday; record zero when work produced no units. */
		piece_units: { kind: 'decimal', scale: 2, min: 0, optional: true },
		/** Wage earned for each completed unit on this workday. */
		piece_unit_rate: { kind: 'decimal', scale: 2, min: 0, optional: true },
		/** Who asked for rest-day work (SG s.37(2)/(3)); null is the employer. */
		requested_by: { kind: 'enum', values: ['EMPLOYER', 'EMPLOYEE'], optional: true },
		/** Extra hours forced by a disaster, accident or emergency (TW 勞基法 §32(4)). */
		emergency_cause: { kind: 'bool', optional: true },
		/** The worker elected time off in lieu of the day's overtime pay (TW 勞基法 §32-1). */
		time_off_in_lieu: { kind: 'bool', optional: true }
	},
	unique: [{ fields: ['employment_id', 'work_date'] }],
	index: ['work_date']
});
