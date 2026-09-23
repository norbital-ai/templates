import { client } from '../../workspace-client.js';

/** A contract is sealed by the rows that reference it; the transform is the guard, this is the hint. */
export function contractSeal(employmentId: () => string) {
	const consumers = $derived(
		[
			client.db.employment_terms,
			client.db.claim_requests,
			client.db.adhoc_requests,
			client.db.loans,
			client.db.loan_repayments,
			client.db.leave_entries,
			client.db.work_days,
			client.db.payslips
		].map((collection) =>
			collection.findFirst({
				where: { employment_id: { eq: employmentId() } },
				columns: { id: true }
			})
		)
	);
	const sealed = $derived(consumers.some((query) => query.current != null));
	const loading = $derived(consumers.some((query) => query.loading));
	return {
		get sealed() {
			return sealed;
		},
		get loading() {
			return loading;
		}
	};
}
