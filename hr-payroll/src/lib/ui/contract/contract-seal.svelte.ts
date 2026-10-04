import type { Id } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { liveRows } from '../state/live.svelte.js';

/** The collections whose rows seal a contract by naming it. */
const CONSUMERS = [
	'employment_terms',
	'claim_requests',
	'adhoc_requests',
	'loans',
	'loan_repayments',
	'leave_entries',
	'work_days',
	'payslips'
] as const;

/** A contract is sealed by the rows that reference it; the transform is the guard, this is the hint. */
export function contractSeal(employmentId: () => Id<'employments'> | undefined) {
	const consumers = CONSUMERS.map((collection) =>
		liveRows(() => {
			const id = employmentId();
			return id == null
				? null
				: bolt.read(collection, { where: { employment_id: { eq: id } }, limit: 1 });
		})
	);
	return {
		get sealed() {
			return consumers.some((rows) => (rows.current?.length ?? 0) > 0);
		},
		get loading() {
			return consumers.some((rows) => rows.loading);
		}
	};
}
