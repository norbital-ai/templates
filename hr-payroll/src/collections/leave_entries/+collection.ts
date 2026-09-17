import { Effect } from 'effect';
import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { readLeaveContext } from '../../lib/leave/context.js';
import { leaveActivityOf } from '../../lib/leave/activity-fields.js';
import { timeOffRangeOf } from '../../lib/leave/activity.js';
import { planLeaveBatch } from '../../lib/leave/plan-batch.js';

/** What a person submits: the activity's own fields. Charges, allocations, the code, the summary and the pin are derived. */
const columns = {
	employment_id: true,
	catalogue_id: true,
	reference: true,
	certificate_file: true,
	from_date: true,
	to_date: true,
	half_day_start: true,
	half_day_end: true,
	days: true,
	encash_days: true,
	as_adjustment_entry: true,
	reversal_of_id: true,
	effective_on: true,
	due_on: true,
	destination_from: true,
	destination_to: true,
	available_from: true,
	expires_on: true,
	reason: true
} as const;

/**
 * A manual Leave activity, validated and frozen: its dated charges and credit allocations are
 * derived here, and each charge carries the calendar it was measured against.
 *
 * Approved entries are immutable and remain audit evidence — there is no `update` and no
 * `delete`; a correction is a linked reversal and replacement. The payroll run's settlement pin
 * (`payslip_id`) arrives as a `link` action on the payslip that consumed the entry.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	transform: (inputs, { db }) =>
		Effect.gen(function* () {
			const employmentIds = inputs.flatMap((row) =>
				row.employment_id == null ? [] : [row.employment_id]
			);
			const ranges = inputs.flatMap((row) =>
				leaveActivityOf(row) === 'TIME_OFF'
					? [timeOffRangeOf(row)].filter((range) => range != null)
					: []
			);
			const window =
				ranges.length === 0
					? undefined
					: {
							start: ranges.map((row) => row.start.date).toSorted()[0]!,
							end: ranges
								.map((row) => row.end.date)
								.toSorted()
								.at(-1)!
						};
			const context = yield* readLeaveContext(
				{ db },
				employmentIds,
				window,
				inputs.some((row) => leaveActivityOf(row) === 'REVERSAL')
			);
			return planLeaveBatch(context, inputs);
		}),
	/**
	 * A held entry — a person's request, or the encashment the exit automation raises for a leaver —
	 * is somebody's decision: every member of the step's approver teams gets it in their inbox in
	 * the same statement that holds the row.
	 */
	notifications: {
		approvalStepRequested: [
			{
				channel: 'inbox',
				recipients: ({ approval }) => (approval?.step.approvers ?? []).map((team) => ({ team })),
				message: ({ ids }) => ({
					title: 'Leave entry awaiting your decision',
					body: `${ids.length === 1 ? 'A leave entry is' : `${ids.length} leave entries are`} held for approval.`
				})
			}
		]
	}
});
