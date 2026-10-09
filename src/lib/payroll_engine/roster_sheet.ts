/** The work-day sheet's shape: the `roster_entry` pipeline's columns and the values its hooks pass each other. */

/** The sheet's columns by the field each fills, as their headers. */
export const SHEET_COLUMNS = {
	employee_number: 'Employee number',
	work_date: 'Date',
	shift_code: 'Shift',
	clock_in: 'Clock in',
	clock_out: 'Clock out',
	overtime_hours: 'Overtime hours',
	overtime_consent: 'OT consent',
	banked_overtime_hours: 'Banked overtime hours',
	incentive_hours: 'Incentive hours',
	leave_code: 'Leave',
	name: 'Name',
	holiday: 'Holiday'
} as const;
export type SheetField = keyof typeof SHEET_COLUMNS;
export const isField = (value: string): value is SheetField => Object.hasOwn(SHEET_COLUMNS, value);

/** One decoded sheet row; `row` is its sheet row number, a blank cell is absent. `name` and `holiday` are read-only. */
export type SheetRecord = {
	readonly row: number;
	readonly employee_number: string;
	readonly work_date: string;
	readonly shift_code?: string;
	readonly clock_in?: string;
	readonly clock_out?: string;
	readonly overtime_hours?: number;
	/** The day's overtime consent as written: Y, yes, true, 1, or a date (an ISO day or an Excel serial). */
	readonly overtime_consent?: string;
	readonly banked_overtime_hours?: number;
	readonly incentive_hours?: number;
	readonly leave_code?: string;
	readonly name?: string;
	readonly holiday?: string;
};

/** What the Work page shows: its entity (which resolves employee numbers) and its period (the template's days). */
export type SheetContext = {
	readonly company_id?: string;
	readonly from?: string;
	readonly to?: string;
};

export type StoredInterval = { readonly start: string; readonly end: string | null };

/** What the sheet's keys name, read once per upload; plain JSON (it crosses into every `map` call). */
export type SheetKnown = {
	/** Why nothing could be resolved (no such entity), or null. */
	readonly failure: string | null;
	readonly contracts: readonly {
		readonly id: string;
		readonly number: string;
		readonly company_id: string;
		readonly from: string | null;
		readonly to: string | null;
		readonly zone: string;
	}[];
	readonly shifts: readonly {
		readonly id: string;
		readonly company_id: string;
		readonly code: string;
		readonly from: string | null;
		readonly to: string | null;
	}[];
	/** `employment:date` → the leave class code recorded on the day. */
	readonly leave: { readonly [key: string]: string };
	/** `company:date` → the governing version's leave class ids by code, for the days the sheet names leave on. */
	readonly classes: { readonly [key: string]: { readonly [code: string]: string } };
	/** `employment:date` → the stored intervals a row keeps (its clock matches them to the minute, or it has none). */
	readonly kept: { readonly [key: string]: readonly StoredInterval[] };
	/** `employment:date` → the stored `overtime_consented_at` (a mark or its own local day restates it). */
	readonly consented: { readonly [key: string]: string };
	/** What the `check` hook reads for the page's entity, read with the rest (`check` then reads nothing). */
	readonly checked?: {
		readonly company_id: string;
		readonly rows: { readonly [key: string]: readonly Readonly<Record<string, unknown>>[] };
	};
};

/** A problem with a sheet row (`row` null: a stored day the sheet does not show), as the pipeline reports it. */
export type SheetFinding = {
	readonly row: number | null;
	readonly column: string;
	readonly message: string;
	readonly severity: 'warn' | 'refuse';
};
