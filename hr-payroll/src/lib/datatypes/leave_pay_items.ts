/** Exact settled Leave outputs, frozen so a later reversal negates them without repricing. */
export type LeavePayItem = {
	/** A frozen wage top-up counts as BASE when replayed or reversed. */
	readonly reserved_line?: 'BASE' | null;
	readonly catalogue_id: string;
	readonly settings_id: string;
	readonly code: string;
	readonly bucket: 'EARNING' | 'ABSENCE';
	readonly date?: string | null;
	readonly amount: number;
	readonly quantity?: number | null;
	readonly rate?: number | null;
};
