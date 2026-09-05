import { Effect, Result, Schema } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { leaveEventValueSchema } from '../../datatypes/leave_event/+definition.js';
import { decodeNumber } from '@norbital-ai/std/json';

export type LeaveBalanceRequest = Pick<
	WorkspaceRow<'leave_requests'>,
	| 'id'
	| 'employment_id'
	| 'leave_type_id'
	| 'leave_account_id'
	| 'kind'
	| 'from_date'
	| 'to_date'
	| 'days'
	| 'event'
	| 'approval_id'
>;
type PendingLeaveApi = {
	db: { leave_requests: Pick<Api<WorkspaceSchema>['db']['leave_requests'], 'findPending'> };
};

/** Pending proposals have no database-generated `days` column yet; measure their sealed event. */
export function measuredLeaveRequestDays(request: Readonly<Record<string, unknown>>): number {
	const event = Reflect.get(request, 'event');
	const raw =
		Reflect.get(request, 'days') ??
		(event != null && typeof event === 'object' ? Reflect.get(event, 'chargeable_days') : null);
	const days = decodeNumber(raw);
	if (!Number.isFinite(days) || days <= 0)
		throw new Error(
			'A pending leave proposal has no server-calculated quantity. Review or withdraw it before relying on the balance.'
		);
	return days;
}
const proposalSchema = Schema.Struct({
	employment_id: Schema.String,
	leave_type_id: Schema.String,
	leave_account_id: Schema.String,
	event: leaveEventValueSchema
});

/** Held creates are approval proposals, not collection rows. Preserve their reservation until rejection or settlement. */
export function withPendingLeaveRequests(
	api: PendingLeaveApi,
	employmentId: string | readonly string[],
	stored: readonly LeaveBalanceRequest[],
	excludeId?: string
): Effect.Effect<LeaveBalanceRequest[]> {
	return Effect.gen(function* () {
		const employmentIds = new Set(typeof employmentId === 'string' ? [employmentId] : employmentId);
		const pending = yield* api.db.leave_requests.findPending({
			where: {
				OR: [
					{ employment_id: { in: [...employmentIds] } },
					...(stored.length === 0 ? [] : [{ id: { in: stored.map((row) => row.id) } }])
				]
			},
			limit: 2000
		});
		if (pending.length >= 2000)
			refuse(
				'The pending leave read reached its safety ceiling; the remaining balance cannot be verified.'
			);
		const rows = new Map(stored.map((row) => [row.id, row]));
		for (const request of pending) {
			if (request.id === excludeId) continue;
			const existing = rows.get(request.id);
			const decoded = Schema.decodeUnknownResult(proposalSchema)({ ...existing, ...request });
			if (Result.isFailure(decoded))
				refuse(
					'A pending leave proposal cannot be measured. Review or withdraw it before making further requests.'
				);
			const proposal = decoded.success;
			if (!employmentIds.has(proposal.employment_id) || proposal.event.kind !== 'TIME_OFF')
				continue;
			if (proposal.event.chargeable_days == null)
				refuse(
					'A pending leave proposal has no server-calculated quantity. Review or withdraw it before making further requests.'
				);
			rows.set(request.id, {
				id: request.id,
				employment_id: proposal.employment_id,
				leave_type_id: proposal.leave_type_id,
				leave_account_id: proposal.leave_account_id,
				kind: 'TIME_OFF',
				event: proposal.event,
				approval_id: request.approval_id,
				from_date: proposal.event.range.start.date,
				to_date: proposal.event.range.end.date,
				days: proposal.event.chargeable_days
			});
		}
		return [...rows.values()];
	});
}
