/** Immutable approval evidence: positive quantities create credits, negatives consume them. */
export type LeaveAllocation = {
	readonly window: { readonly start: string; readonly end: string };
	readonly date: string;
	readonly days: number;
	/** Hour-denominated movement; `days` is zero for this allocation. */
	readonly hours?: number | null;
	/** Null is computed entitlement; otherwise the manual entry that supplied the credit. */
	readonly credit_entry_id?: string | null;
	/** The salary-year end the days originally belong to, carried through transfers (its rate applies). */
	readonly original_date?: string | null;
	/** The pool this allocation draws from where it is not the entry's own (`HOSPITALISATION`). */
	readonly pool?: string | null;
};
