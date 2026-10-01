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
		/** Whether no-pay leave was granted at the employee's request (SG EA ss.88, 88A). */
		no_pay_origin: {
			kind: 'enum',
			values: ['EMPLOYEE_REQUESTED', 'OTHER'],
			optional: true
		},
		/** Time off: the chargeable total. Adjustment: signed, non-zero. Reversal: the source's days. */
		days: { kind: 'decimal', scale: 3, optional: true },
		/** Hourly time off, carry-forward or signed adjustment. */
		hours: { kind: 'decimal', scale: 3, optional: true },
		/** The days an encashment converts to money. */
		encash_days: { kind: 'decimal', scale: 3, optional: true },
		/** Hour-denominated statutory departure payout. */
		encash_hours: { kind: 'decimal', scale: 3, optional: true },
		effective_on: { kind: 'date', optional: true },
		due_on: { kind: 'date', optional: true },
		/** Carry-forward: the window the days or hours land in. */
		destination_from: { kind: 'date', optional: true },
		destination_to: { kind: 'date', optional: true },
		available_from: { kind: 'date', optional: true },
		expires_on: { kind: 'date', optional: true },
		reason: { kind: 'text', optional: true },
		/**
		 * The event or state facts the catalogue row declares in `event_facts` (`leave.facts.<key>`): a
		 * per-event leave's event (`event_kind`, `event_relationship`, `event_child_index`, `event_date`, …,
		 * read by `leaveEventOf`), an agreed day-wage share.
		 */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		/** The activity and the day it turns on, composed by the planner. */
		summary: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['employment_id', 'reference'] }, { fields: ['reversal_of_id'] }],
	index: [['employment_id', 'leave_code', 'effective_on']],
	search: { text: ['summary'] }
});
