/**
 * The contractor board's assignment list query.
 *
 * `+field_ops_contractor.svelte` builds this same object: `orderBy.dispatched_at desc`, and
 * `where.status.eq` only when a status is applied. Clearing the combobox sets the filter to `null`,
 * which omits `where` entirely.
 */
export type ContractorAssignmentStatus = 'unassigned' | 'assigned' | 'completed';

export function contractorAssignmentQuery(appliedStatusFilter: ContractorAssignmentStatus | null): {
	readonly orderBy: { readonly dispatched_at: 'desc' };
	readonly where?: { readonly status: { readonly eq: ContractorAssignmentStatus } };
} {
	return {
		orderBy: { dispatched_at: 'desc' },
		...(appliedStatusFilter == null ? {} : { where: { status: { eq: appliedStatusFilter } } })
	};
}
