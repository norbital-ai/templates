import { model } from '@norbital-ai/bolt';
import { AREAS, SKILLS } from '../../../lib/matching.js';

/**
 * One occurrence of a booking at one time, held by one helper. The address and skill are the booking's, copied so a
 * match reads one row. `shift_check` is the pre-shift confirmation; `attention` is why dispatch must act on it.
 */
export default model({
	description:
		'A visit: when, where, which helper, and where its shift confirmation and ETA check stand.',
	icon: 'lucide:calendar-clock',
	label: 'number',
	fields: {
		number: { kind: 'seq', pattern: 'V-{yyyy}-{00000}' },
		slot: { kind: 'period', of: 'instant' },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		skill: { kind: 'enum', values: SKILLS },
		status: {
			kind: 'state',
			initial: 'scheduled',
			states: {
				scheduled: { to: ['in_progress', 'cancelled'] },
				in_progress: {
					to: ['done'],
					edit: ['status', 'completion_notes', 'completed_at', 'attention']
				},
				done: { edit: 'none' },
				cancelled: { edit: 'none' }
			}
		},
		shift_check: {
			kind: 'enum',
			values: ['not_due', 'asked', 'confirmed', 'no_response', 'declined'],
			default: 'not_due'
		},
		shift_asked_at: { kind: 'instant', optional: true },
		/** The helper declined with a medical certificate: excused, no warning. */
		mc: { kind: 'bool', default: false },
		eta_minutes: { kind: 'int', optional: true },
		eta_checked_at: { kind: 'instant', optional: true },
		attention: {
			kind: 'enum',
			values: ['none', 'unassigned', 'eta_risk', 'helper_left', 'awaiting_approval'],
			default: 'none'
		},
		proposed_slot: { kind: 'period', of: 'instant', optional: true },
		/** Stamped by the transform when the helper starts and finishes. */
		started_at: { kind: 'instant', optional: true },
		completed_at: { kind: 'instant', optional: true },
		completion_notes: { kind: 'text', max: 2000, optional: true },
		/** Cancelled less than a day before the start: chargeable. */
		late_cancellation: { kind: 'bool', default: false }
	},
	index: ['attention', 'shift_check'],
	noOverlap: [{ key: ['helper'], period: 'slot', where: { status: { ne: 'cancelled' } } }]
});
