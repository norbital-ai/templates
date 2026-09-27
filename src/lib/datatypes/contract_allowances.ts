import { isSettledId } from '../iso-day.js';

/**
 * One allowance a contract carries: the `allowance_catalogue` class and the monthly figure it
 * states (0 where the class's bands price it from the person), prorated like basic salary.
 */
export type ContractAllowance = { readonly catalogue_id: string; readonly amount: number };

export function contractAllowancesFault(rows: readonly ContractAllowance[]): string | undefined {
	if (rows.some((row) => !isSettledId(row.catalogue_id) || row.amount < 0))
		return 'An allowance names its class and a non-negative amount.';
	if (new Set(rows.map((row) => row.catalogue_id)).size !== rows.length)
		return 'A contract lists each allowance class once.';
	return undefined;
}
