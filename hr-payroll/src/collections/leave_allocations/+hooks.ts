import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { dateKey } from '../../lib/iso-day.js';
import { withPendingLeaveRequests } from '../../lib/leave/pending.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Validates the employment, event-based leave type, positive half-day allowance, dates and eligibility evidence. An allocation referenced by a request is immutable.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (
							existing &&
							(yield* withPendingLeaveRequests(api, existing.employment_id, [])).some(
								(row) => row.allocation_id === existing.id
							)
						)
							refuse('This allocation has a pending leave request and cannot change.');
						if (
							existing &&
							(yield* api.db.leave_requests.findFirst({
								where: { allocation_id: { eq: existing.id } },
								columns: { id: true }
							}))
						)
							refuse(
								'This allocation already has leave requests. Its approved allowance and eligibility evidence cannot change.'
							);
						const row = { ...existing, ...input };
						if (row.employment_id == null || row.leave_type_id == null)
							refuse('An allocation must name its employment and leave type.');
						const [employment, leaveType] = yield* Effect.all([
							api.db.employments.findFirst({ where: { id: { eq: row.employment_id } } }),
							api.db.leave_types.findFirst({ where: { id: { eq: row.leave_type_id } } })
						]);
						if (!employment || !leaveType || employment.company_id !== leaveType.company_id)
							refuse(
								'The allocation must name an employment and leave type belonging to the same company.'
							);
						if (leaveType.accrual.kind !== 'PER_EVENT')
							refuse(
								'Only event-based leave uses an allocation. Annual leave uses its accrued balance.'
							);
						const days = decodeNumber(row.allocated_days);
						if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days * 2))
							refuse('Allocate a positive number of scheduled workdays in half-day increments.');
						if (row.qualifying_date == null || row.starts_on == null || row.expires_on == null)
							refuse('State the qualifying event, first eligible date and inclusive expiry date.');
						const qualifying = dateKey(row.qualifying_date);
						const start = dateKey(row.starts_on);
						const end = dateKey(row.expires_on);
						if (
							!qualifying ||
							!start ||
							!end ||
							qualifying > end ||
							start > end ||
							start < dateKey(employment.hire_date)
						)
							refuse('The allocation dates must cover the qualifying event and employment.');
						const reference = row.event_reference?.trim();
						const evidence = row.eligibility_evidence?.trim();
						if (!reference || !evidence)
							refuse(
								'State a unique event reference and the verified eligibility or shared-allocation evidence.'
							);
						return {
							...input,
							event_reference: reference.toUpperCase(),
							eligibility_evidence: evidence
						};
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retains allocations referenced by any leave request.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						if (
							(yield* withPendingLeaveRequests(api, existing.employment_id, [])).some(
								(row) => row.allocation_id === existing.id
							)
						)
							refuse('An allocation with a pending leave request cannot be deleted.');
						if (
							yield* api.db.leave_requests.findFirst({
								where: { allocation_id: { eq: existing.id } },
								columns: { id: true }
							})
						)
							refuse('An allocation referenced by a leave request cannot be deleted.');
					})
			}
		}
	}
} satisfies Hooks;
