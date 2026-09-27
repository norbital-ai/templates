import { model } from '@norbital-ai/bolt';

/**
 * A manual Leave activity. Which activity an entry is follows from the fields it carries (`leaveActivityOf`); the
 * transform stores the answer in `activity`, because the grants' approval routes and scopes match on it and
 * `charges` is a list no `Where` reads.
 */
export default model({
	description:
		'An approved manual Leave activity: time off with dated charges, an encashment, a carry-forward, a signed adjustment, or a reversal that negates its source. Entitlement is computed; approval never creates a second usage movement. Payroll links the entry that settled it through `payslip_id`.',
	icon: 'lucide:calendar-days',
	label: 'summary',
	fields: {
		/** Derived by the transform from the submitted fields. */
		activity: {
			kind: 'enum',
			values: ['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL']
		},
		/** Stable leave identity, resolved from the catalogue and retained across its revisions. */
		leave_code: { kind: 'text' },
		reference: { kind: 'text' },
		certificate_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** Approval evidence, derived by the transform: callers never supply quantities or calendar inputs. */
		charges: { kind: 'custom', of: 'leave_charges' },
		allocations: { kind: 'custom', of: 'leave_allocations' },
		/** The reversal marker: this entry reverses `reversal_of_id`. */
		as_adjustment_entry: { kind: 'bool', default: false },
		/** Time off: the range start. Encashment and adjustment: the valuation day. */
		from_date: { kind: 'date', optional: true },
		/** Time off: the range end. Encashment: the source window end. */
		to_date: { kind: 'date', optional: true },
		half_day_start: { kind: 'bool', optional: true },
		half_day_end: { kind: 'bool', optional: true },
		/** Time off: the chargeable total. Adjustment: signed, non-zero. Reversal: the source's days. */
		days: { kind: 'decimal', scale: 3, optional: true },
		/** Time off by the hour: the hours, one day at a time. */
		hours: { kind: 'decimal', scale: 3, optional: true },
		/** The days an encashment converts to money. */
		encash_days: { kind: 'decimal', scale: 3, optional: true },
		effective_on: { kind: 'date', optional: true },
		due_on: { kind: 'date', optional: true },
		/** Carry-forward: the window the days land in. */
		destination_from: { kind: 'date', optional: true },
		destination_to: { kind: 'date', optional: true },
		available_from: { kind: 'date', optional: true },
		expires_on: { kind: 'date', optional: true },
		reason: { kind: 'text', optional: true },
		/** The event a PER_EVENT leave answers to: what, to whom, which child (1-based) and when. */
		event_kind: { kind: 'text', optional: true },
		event_relationship: { kind: 'text', optional: true },
		event_child_index: { kind: 'int', min: 1, optional: true },
		event_date: { kind: 'date', optional: true },
		/** The activity and the day it turns on, composed by the planner. */
		summary: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['employment_id', 'reference'] }, { fields: ['reversal_of_id'] }],
	index: [['employment_id', 'leave_code', 'effective_on']],
	search: { text: ['summary'] }
});
