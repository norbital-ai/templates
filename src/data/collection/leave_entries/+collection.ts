import { collection, type TransformRow } from '@norbital-ai/bolt';
import { readLeaveContext } from '../../../lib/leave/context.js';
import { leaveActivityOf } from '../../../lib/leave/activity-fields.js';
import { timeOffRangeOf, type LeaveSubmission } from '../../../lib/leave/activity.js';
import { planLeaveBatch } from '../../../lib/leave/plan-batch.js';
import { previewLeave, type PreviewLeaveInput } from '../../../lib/leave/preview.js';
import { leaveBalanceSummaries } from '../../../lib/leave/summary.js';
import { plain } from '../../../lib/wire.js';

/** Manual leave activities: create only, so an approved entry is immutable; a correction is a linked reversal and replacement. The payroll pin arrives as a `link` on the payslip that consumed the entry. */
const c = collection('leave_entries', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'catalogue_id',
				'reference',
				'certificate_file',
				'from_date',
				'to_date',
				'half_day_start',
				'half_day_end',
				'days',
				'hours',
				'encash_days',
				'as_adjustment_entry',
				'reversal_of_id',
				'effective_on',
				'due_on',
				'destination_from',
				'destination_to',
				'available_from',
				'expires_on',
				'reason',
				'event_kind',
				'event_relationship',
				'event_child_index',
				'event_date'
			]
		}
	},
	queries: {
		leave_balances: {
			description:
				'Computes annual leave balances and reservations from effective catalogue rules and manual activity as the calling user.',
			input: { employment_id: { kind: 'id', of: 'employments' }, as_of: { kind: 'date' } },
			output: { kind: 'json' }
		},
		preview_leave: {
			description:
				'Computes leave availability and dated charges from catalogue rules, employment history, manual activity and jurisdiction holidays using the same planner as approval.',
			input: {
				employment_id: { kind: 'id', of: 'employments' },
				catalogue_id: { kind: 'id', of: 'leave_catalogue' },
				/** A calendar month, YYYY-MM. */
				calendar_month: { kind: 'text', optional: true },
				range: {
					kind: 'object',
					optional: true,
					fields: {
						start: {
							kind: 'object',
							fields: {
								date: { kind: 'date' },
								half: { kind: 'enum', values: ['FIRST', 'SECOND'] }
							}
						},
						end: {
							kind: 'object',
							fields: {
								date: { kind: 'date' },
								half: { kind: 'enum', values: ['FIRST', 'SECOND'] }
							}
						}
					}
				},
				exclude_entry_id: { kind: 'id', of: 'leave_entries', optional: true }
			},
			output: { kind: 'json' }
		}
	},
	notifications: {
		// a held entry is somebody's decision: the step's approver teams get it in their inbox
		approvalStepRequested: [
			{
				channel: 'inbox',
				to: ['step_approvers'],
				title: 'Leave entry awaiting your decision',
				body: {
					one: 'A leave entry is held for approval.',
					many: '{count} leave entries are held for approval.'
				}
			}
		]
	}
});
export default c;

/**
 * A manual Leave activity, validated and frozen: its dated charges and credit allocations are
 * derived here, and each charge carries the calendar it was measured against. The batch is planned
 * against one read of the employments' history (`readLeaveContext`, as the workspace).
 */
c.transform(async (inputs, ctx) => {
	const rows = inputs.map(
		(input) => plain(input) as Partial<LeaveSubmission> & { certificate_file?: unknown }
	);
	const ranges = rows.flatMap((row) => {
		const range = leaveActivityOf(row) === 'TIME_OFF' ? timeOffRangeOf(row) : null;
		return range == null ? [] : [range];
	});
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
	const context = await readLeaveContext(
		ctx.db,
		rows.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])),
		window,
		rows.some((row) => leaveActivityOf(row) === 'REVERSAL')
	);
	// repository-health:allow R3b -- the planner speaks plain ids; the transform row brands them
	return planLeaveBatch(context, rows) as unknown as TransformRow<'leave_entries'>[];
});

/** Balances as the caller: the same read and rules as approval, over the caller's own grants. */
c.query('leave_balances', async (input, ctx) => {
	const { employment_id, as_of } = plain(input) as { employment_id: string; as_of: string };
	return leaveBalanceSummaries(await readLeaveContext(ctx, [employment_id]), employment_id, as_of);
});

c.query('preview_leave', async (input, ctx) =>
	previewLeave(ctx, plain(input) as PreviewLeaveInput)
);
