import {
	refuse,
	type Api,
	type CollectionHooks,
	type MutateBeforeContext
} from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';

type CaptureSource = 'allowance_requests' | 'leave_entries' | 'loan_repayments';
type Parent = MutateBeforeContext<
	CollectionHooks<WorkspaceSchema, 'payslip_leave_inputs'>
>['parent'];

export type PreparedCaptureContracts = {
	readonly sources: ReadonlyMap<string, string>;
	readonly payslips: ReadonlyMap<string, string>;
};

/** Prepare stored links once per batch; a nested payslip may not exist until this graph commits. */
export function prepareCaptureContracts(
	api: Api<WorkspaceSchema, unknown>,
	source: CaptureSource,
	sourceIds: readonly (string | null | undefined)[],
	payslipIds: readonly (string | null | undefined)[]
) {
	return Effect.gen(function* () {
		const ids = [...new Set(sourceIds.filter((id): id is string => id != null))];
		const owners = [...new Set(payslipIds.filter((id): id is string => id != null))];
		const sourceQuery = {
			where: { id: { in: ids } },
			columns: { id: true, employment_id: true },
			limit: ids.length
		} as const;
		const sources = ids.length
			? yield* {
					allowance_requests: () => api.db.allowance_requests.findMany(sourceQuery),
					leave_entries: () => api.db.leave_entries.findMany(sourceQuery),
					loan_repayments: () => api.db.loan_repayments.findMany(sourceQuery)
				}[source]()
			: [];
		const payslips = owners.length
			? yield* api.db.payslips.findMany({
					where: { id: { in: owners } },
					columns: { id: true, employment_id: true },
					limit: owners.length
				})
			: [];
		return {
			sources: new Map(sources.map((row) => [row.id, row.employment_id])),
			payslips: new Map(payslips.map((row) => [row.id, row.employment_id]))
		};
	});
}

/** Captures connect existing family inputs to exactly the payslip's employment contract. */
export function withCaptureContract<T extends { readonly payslip_id?: string | null }>(
	input: T,
	existing: object | undefined,
	sourceId: string | null | undefined,
	prepared: PreparedCaptureContracts,
	parent?: Parent
): T {
	if (existing !== undefined)
		refuse(
			'A captured input cannot be edited. Delete the draft payroll before changing its sources.'
		);
	const enclosingPayslip =
		parent?.collection === 'payslips' && parent.column === 'payslip_id' ? parent : undefined;
	if (parent && !enclosingPayslip) refuse('A nested capture must be created through its payslip.');
	if (enclosingPayslip && input.payslip_id != null && input.payslip_id !== enclosingPayslip.id)
		refuse('A nested capture cannot name a different payslip.');
	const payslipContract = enclosingPayslip
		? enclosingPayslip.values.employment_id
		: input.payslip_id == null
			? undefined
			: prepared.payslips.get(input.payslip_id);
	if (!payslipContract)
		refuse('A capture must reference an existing payslip and its employment contract.');
	const sourceContract = sourceId == null ? undefined : prepared.sources.get(sourceId);
	if (!sourceContract)
		refuse('A capture must reference an existing source and its employment contract.');
	if (sourceContract !== payslipContract)
		refuse('A captured input must use the same employment contract as its payslip.');
	return input;
}
