import { Effect, Result, Schema } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_entries/$types.js';
import { leaveEventValueSchema } from '../../datatypes/leave_event/+definition.js';
import { leaveAllocationsValueSchema } from '../../datatypes/leave_allocations/+definition.js';
import { leaveChargesValueSchema } from '../../datatypes/leave_charges/+definition.js';

export type LeaveActivity = Pick<
	WorkspaceRow<'leave_entries'>,
	| 'id'
	| 'employment_id'
	| 'leave_catalogue_id'
	| 'leave_code'
	| 'reference'
	| 'event'
	| 'charges'
	| 'allocations'
	| 'approval_id'
>;

const proposalSchema = Schema.Struct({
	employment_id: Schema.String,
	leave_catalogue_id: Schema.String,
	leave_code: Schema.String,
	reference: Schema.String,
	event: leaveEventValueSchema,
	charges: leaveChargesValueSchema,
	allocations: leaveAllocationsValueSchema
});

/** Held activity reserves its original server-measured debits until approval or rejection. */
export function withPendingLeaveEntries(
	api: { db: { leave_entries: Pick<Api<WorkspaceSchema>['db']['leave_entries'], 'findPending'> } },
	employmentIds: readonly string[],
	stored: readonly LeaveActivity[]
): Effect.Effect<LeaveActivity[]> {
	return Effect.gen(function* () {
		if (employmentIds.length === 0) return [];
		const pending = yield* api.db.leave_entries.findPending({
			where: { employment_id: { in: [...employmentIds] } },
			limit: 2000
		});
		if (pending.length >= 2000)
			refuse('The pending leave read reached its safety ceiling; the balance cannot be verified.');
		const rows = new Map(stored.map((row) => [row.id, row]));
		for (const row of pending) {
			const decoded = Schema.decodeUnknownResult(proposalSchema)({ ...rows.get(row.id), ...row });
			if (Result.isFailure(decoded))
				refuse(
					'A pending leave entry has no valid approval evidence. Review or withdraw it before submitting more leave.'
				);
			rows.set(row.id, { ...decoded.success, id: row.id, approval_id: row.approval_id });
		}
		return [...rows.values()];
	});
}
