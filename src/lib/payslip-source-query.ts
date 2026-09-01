type IdSource =
	| {
			readonly current?: readonly { readonly id: string }[] | undefined;
	  }
	| null
	| undefined;

type ComponentEntryCaptureQuery = {
	readonly where: { readonly component_entry_id: { readonly in: readonly string[] } };
	readonly columns: { readonly component_entry_id: true; readonly period: true };
	readonly limit: 1000;
};

type LeaveRequestSettlementQuery = {
	readonly where: { readonly leave_request_id: { readonly in: readonly string[] } };
	readonly columns: { readonly leave_request_id: true; readonly period: true };
	readonly limit: 1000;
};

type QueryByKey = {
	readonly component_entry_id: ComponentEntryCaptureQuery;
	readonly leave_request_id: LeaveRequestSettlementQuery;
};

const queryFor = <K extends keyof QueryByKey>(
	foreignKey: K,
	ids: readonly string[]
): QueryByKey[K] => {
	if (foreignKey === 'component_entry_id') {
		return {
			where: { component_entry_id: { in: ids } },
			columns: { component_entry_id: true, period: true },
			limit: 1000
		} as QueryByKey[K];
	}
	return {
		where: { leave_request_id: { in: ids } },
		columns: { leave_request_id: true, period: true },
		limit: 1000
	} as QueryByKey[K];
};

/**
 * Second-hop payslip input read: the source listing has ids, the capture table has no nested
 * inverse, and both controller pages ask for the same `{ foreignKey in ids, period }` page.
 */
export const relatedPayslipInputs = <K extends keyof QueryByKey, TResult>(
	source: IdSource,
	foreignKey: K,
	findMany: (query: QueryByKey[K]) => TResult
): TResult | null => {
	const ids = (source?.current ?? []).map((row) => row.id);
	if (ids.length === 0) return null;
	return findMany(queryFor(foreignKey, ids));
};
