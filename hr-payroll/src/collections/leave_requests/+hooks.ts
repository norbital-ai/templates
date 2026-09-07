import { Effect } from 'effect';
import { refuse, type MutateBeforeContext } from '@norbital-ai/bolt/authoring';
import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import {
	leaveEntitlementIdFor,
	leaveEntryIdFor,
	requestSourceKey
} from '../../lib/leave/identity.js';
import { leaveYearOf } from '../../lib/leave/reconcile.js';
import { firstLeavePreviewRefusal, previewLeave } from '../../lib/leave/preview.js';

type HookApi = MutateBeforeContext<Hooks>['api'];

function normalizedTimeOff(
	api: HookApi,
	employmentId: string,
	leaveTypeId: string,
	entitlementId: string,
	event: LeaveEvent,
	certificateFile: unknown,
	excludeId?: string
): Effect.Effect<LeaveEvent> {
	return Effect.gen(function* () {
		const preview = yield* previewLeave(api, {
			employment_id: employmentId,
			leave_type_id: leaveTypeId,
			leave_entitlement_id: entitlementId,
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
				// The account a request draws on is named by formula from its employment, leave type and
				// leave year, so a caller — the employee's app or a bulk import — never has to know an
				// account id. What the formula needs is read once for the whole batch.
				const typeIds = [
					...new Set(
						inputs.flatMap((row) => (row.leave_type_id == null ? [] : [row.leave_type_id]))
					)
				];
				const types =
					typeIds.length === 0
						? []
						: yield* api.db.leave_types.findMany({
								where: { id: { in: typeIds } },
								limit: typeIds.length
							});
				return { typeCodes: new Map(types.map((type) => [type.id, type.code])) };
			}),
		perRecord: {
			before: {
				description:
					'Requires a generated entitlement covering the whole range, normalizes chargeable scheduled time, checks overlap, balance, eligibility, paid-payroll locks and certificate policy, and returns the request with the TAKEN ledger line it charges nested under it, so the line is held with the request and lands when it is approved.',
				handler: ({ input, existing, recordId, prepared, api }) =>
					Effect.gen(function* () {
						if (existing != null) yield* assertUnlocked(api, existing, 'Changing a leave request');
						const employmentId = input.employment_id ?? existing?.employment_id;
						const leaveTypeId = input.leave_type_id ?? existing?.leave_type_id;
						const event = input.event ?? existing?.event;
						const derivedEntitlementId =
							employmentId != null && leaveTypeId != null && event != null
								? leaveEntitlementIdFor({
										employment_id: employmentId,
										leave_code: prepared.typeCodes.get(leaveTypeId) ?? '',
										leave_year: leaveYearOf(event.range.start.date)
									})
								: null;
						const entitlementId =
							input.leave_entitlement_id ?? existing?.leave_entitlement_id ?? derivedEntitlementId;
						const certificate =
							input.certificate_file !== undefined
								? input.certificate_file
								: existing?.certificate_file;
						if (
							employmentId == null ||
							leaveTypeId == null ||
							entitlementId == null ||
							event == null
						)
							refuse(
								'A leave request needs an employment, leave type, generated entitlement and range.'
							);
						const normalized = yield* normalizedTimeOff(
							api,
							employmentId,
							leaveTypeId,
							entitlementId,
							event,
							certificate,
							recordId
						);
						// The line the request charges, under the id the reconciler's own restatement uses,
						// so whichever write comes first creates it and the other finds it. It is the
						// request's (a cascade edge): held with it, landed on approval, or landed at once
						// when the grant carries no route. A stored line is restated by id only, because
						// the ledger is append-only and an edited request never rewrites what it posted.
						const sourceKey = requestSourceKey(recordId);
						const entryId = leaveEntryIdFor({
							leave_entitlement_id: entitlementId,
							source_key: sourceKey
						});
						const posted = yield* api.db.leave_entries.findFirst({
							where: { id: { eq: entryId } },
							columns: { id: true }
						});
						const start = normalized.range.start.date;
						// A stored line is restated by id alone (the complete set), which the insert shape
						// cannot name; the runtime reads the id as the update it is.
						const line =
							posted != null
								? [{ id: entryId }]
								: [
										{
											id: entryId,
											leave_entitlement_id: entitlementId,
											kind: 'TAKEN' as const,
											effective_on: start,
											days: -Math.abs(normalized.chargeable_days ?? 0),
											reason: 'Approved leave request',
											source_key: sourceKey
										}
									];
						return {
							...input,
							leave_entitlement_id: entitlementId,
							event: normalized,
							leave_entry_request: line as never
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
} satisfies Hooks<{ readonly typeCodes: Map<string, string> }>;
