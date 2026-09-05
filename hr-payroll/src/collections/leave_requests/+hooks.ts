import { Effect } from 'effect';
import { refuse, type MutateBeforeContext } from '@norbital-ai/bolt/authoring';
import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import { firstLeavePreviewRefusal, previewLeave } from '../../lib/leave/preview.js';

type HookApi = MutateBeforeContext<Hooks>['api'];

function normalizedTimeOff(
	api: HookApi,
	employmentId: string,
	leaveTypeId: string,
	accountId: string,
	event: LeaveEvent,
	certificateFile: unknown,
	excludeId?: string
): Effect.Effect<LeaveEvent> {
	return Effect.gen(function* () {
		const preview = yield* previewLeave(api, {
			employment_id: employmentId,
			leave_type_id: leaveTypeId,
			leave_account_id: accountId,
			range: event.range,
			...(excludeId == null ? {} : { exclude_request_id: excludeId })
		});
		const refusal = firstLeavePreviewRefusal(preview);
		if (refusal != null) refuse(refusal);
		if (preview.certificate_required && certificateFile == null)
			refuse('A certificate is required for this request.');
		if (preview.chargeable_days == null || preview.chargeable_days <= 0)
			refuse('The selected range contains no eligible scheduled work time.');
		return { ...event, chargeable_days: preview.chargeable_days };
	});
}

function assertUnlocked(
	api: HookApi,
	existing: WorkspaceRow<'leave_requests'>,
	action: string
): Effect.Effect<void> {
	return refuseIfCaptured({
		capture: api.db.payslip_leave_request_inputs.findFirst({
			where: { leave_request_id: { eq: existing.id } },
			columns: { period: true }
		}),
		approvalId: existing.approval_id,
		action
	});
}

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const ids = inputs.flatMap((row) => (row.id == null ? [] : [row.id]));
				const stored =
					ids.length === 0
						? []
						: yield* api.db.leave_requests.findMany({
								where: { id: { in: ids } },
								limit: ids.length
							});
				const employments = new Set<string>();
				for (const input of inputs) {
					const employmentId =
						input.employment_id ?? stored.find((row) => row.id === input.id)?.employment_id;
					if (employmentId == null) continue;
					if (employments.has(employmentId))
						refuse('Apply one leave request per employment at a time.');
					employments.add(employmentId);
				}
			}),
		perRecord: {
			before: {
				description:
					'Requires an approved generated account covering the whole range, then normalizes chargeable scheduled time and checks overlap, balance, eligibility, paid-payroll locks and certificate policy.',
				handler: ({ input, existing, recordId, api }) =>
					Effect.gen(function* () {
						if (existing != null) yield* assertUnlocked(api, existing, 'Changing a leave request');
						const employmentId = input.employment_id ?? existing?.employment_id;
						const leaveTypeId = input.leave_type_id ?? existing?.leave_type_id;
						const accountId = input.leave_account_id ?? existing?.leave_account_id;
						const event = input.event ?? existing?.event;
						const certificate =
							input.certificate_file !== undefined
								? input.certificate_file
								: existing?.certificate_file;
						if (employmentId == null || leaveTypeId == null || accountId == null || event == null)
							refuse(
								'A leave request needs an employment, leave type, generated account and range.'
							);
						return {
							...input,
							event: yield* normalizedTimeOff(
								api,
								employmentId,
								leaveTypeId,
								accountId,
								event,
								certificate,
								recordId
							)
						};
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuses deleting a leave request already captured by payroll.',
				handler: ({ existing, api }) => assertUnlocked(api, existing, 'Deleting a leave request')
			}
		}
	}
} satisfies Hooks;
