import { Effect } from 'effect';
import { refuse, type MutateBeforeContext } from '@norbital-ai/bolt/authoring';
import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { certificatePolicyIssues, certificatePolicyMismatchMessage } from './certificate-policy.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import {
	firstLeavePreviewRefusal,
	previewLeave,
	type LeavePreviewApi
} from '../../lib/leave/preview.js';

type HookApi = MutateBeforeContext<Hooks>['api'];
type TimeOffEvent = Extract<LeaveEvent, { kind: 'TIME_OFF' }>;

function normalizedTimeOff(
	api: LeavePreviewApi,
	employmentId: string,
	leaveTypeId: string,
	event: TimeOffEvent,
	excludeId?: string,
	allocationId?: string | null
): Effect.Effect<TimeOffEvent> {
	return Effect.gen(function* () {
		const preview = yield* previewLeave(api, {
			employment_id: employmentId,
			leave_type_id: leaveTypeId,
			...(allocationId == null ? {} : { allocation_id: allocationId }),
			range: event.range,
			...(excludeId == null ? {} : { exclude_request_id: excludeId })
		});
		const refusal = firstLeavePreviewRefusal(preview);
		if (refusal != null) refuse(refusal);
		if (preview.chargeable_days == null || preview.chargeable_days <= 0) {
			refuse(
				'The selected range contains no scheduled work half-days after holidays and rest/off days are excluded.'
			);
		}
		return {
			...event,
			range: event.range,
			chargeable_days: preview.chargeable_days
		};
	});
}

/** The shared settlement-lock refusal, over the leave-request capture junction. */
function assertLeaveSourceUnlocked(
	api: HookApi,
	existing: WorkspaceRow<'leave_requests'>,
	action: string
): Effect.Effect<void, never, never> {
	/**
	 * The settlement lock, and now the only thing that freezes an existing leave request.
	 *
	 * Leave used to be held by three facts that were not consumption: an approval stamp, a passed
	 * date, and a paid window around the request's days. The owner's rule is that a record locks
	 * only when a payslip consumed it — so `APPROVED` and `DATE_PASSED` stop blocking here, and
	 * the window keeps only its create-side job, which is the settled-day issue inside
	 * `previewLeave`: a new or moved range may not touch days a paid run already priced.
	 * What is left is a row in the leave-request input junction naming this request, which says
	 * payroll `period` took it into account and names the run that has to be deleted (while it is
	 * still a draft) to release it.
	 *
	 * A capture with no monetary output locks exactly as hard as one that deducted money: it says
	 * the run read this request and priced it at nothing, which is a settlement and not an
	 * absence. That is why the lookup asks whether a capture exists rather than what it paid.
	 */
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
					const row = { ...stored.find((record) => record.id === input.id), ...input };
					if (row.event?.kind !== 'TIME_OFF' || row.employment_id == null) continue;
					if (employments.has(row.employment_id))
						refuse(
							'Apply one leave request per employment at a time so each request sees the latest reservations.'
						);
					employments.add(row.employment_id);
				}
			}),
		perRecord: {
			before: {
				description:
					'Normalizes one half-day-stepped leave range via the shared leave preview: excludes observed holidays and scheduled rest/off days, refuses overlaps, requests beyond the projected balance and certificates attached to a non-time-off event. On an edit it first refuses a request a payroll run has already taken into account, then re-checks the patched range so a change cannot bypass schedule exclusions, overlap protection or balance limits.',
				handler: ({ input, existing, recordId, api }) =>
					Effect.gen(function* () {
						// Only an edit can violate a settlement: a create has no prior run that consumed it.
						if (existing !== undefined)
							yield* assertLeaveSourceUnlocked(api, existing, 'Changing a leave request');
						const event = input.event ?? existing?.event;
						const certificateFile =
							input.certificate_file !== undefined
								? input.certificate_file
								: existing?.certificate_file;
						const certificateIssues = certificatePolicyIssues({
							eventKind: event?.kind ?? null,
							certificateFile
						});
						if (certificateIssues.length > 0)
							refuse(certificatePolicyMismatchMessage(certificateIssues));
						const allocationId =
							input.allocation_id !== undefined ? input.allocation_id : existing?.allocation_id;
						if (event == null || event.kind !== 'TIME_OFF') {
							if (allocationId != null)
								refuse('Only time-off requests may consume an event allocation.');
							return input;
						}
						const employmentId = input.employment_id ?? existing?.employment_id;
						if (employmentId == null)
							refuse('A time-off request must reference an employment on file.');
						const leaveTypeId = input.leave_type_id ?? existing?.leave_type_id;
						if (leaveTypeId == null)
							refuse('A time-off request must reference a leave type on file.');
						return {
							...input,
							event: yield* normalizedTimeOff(
								api,
								employmentId,
								leaveTypeId,
								event,
								recordId,
								allocationId
							)
						};
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a leave request a payroll run has already taken into account. Corrections are new events.',
				handler: ({ existing, api }) =>
					assertLeaveSourceUnlocked(api, existing, 'Deleting a leave request')
			}
		}
	}
} satisfies Hooks;
