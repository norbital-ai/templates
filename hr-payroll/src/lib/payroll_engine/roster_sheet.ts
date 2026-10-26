/** The work-day sheet's shape: the `roster_entry` file sync's columns and its resolved native values. */
import type { Id, Instant, PlainDate, Row } from '@norbital-ai/bolt';
import type { SheetScopeRead } from './roster_import.js';

/** The sheet's columns by the field each fills, as their headers. */
export const SHEET_COLUMNS = {
	employee_number: 'Employee number',
	work_date: 'Date',
	shift_code: 'Shift',
	clock_in: 'Clock in',
	clock_out: 'Clock out',
	overtime_consent: 'OT consent',
	banked_overtime_hours: 'Banked overtime hours',
	leave_code: 'Leave',
	name: 'Name',
	holiday: 'Holiday',
	planned_overtime_hours: 'Planned OT hours',
	approved_ot_1_start: 'Approved OT 1 start',
	approved_ot_1_end: 'Approved OT 1 end',
	approved_ot_2_start: 'Approved OT 2 start',
	approved_ot_2_end: 'Approved OT 2 end',
	approved_ot_1_break_minutes: 'Approved OT 1 break minutes',
	approved_ot_2_break_minutes: 'Approved OT 2 break minutes'
} as const;
export type SheetField = keyof typeof SHEET_COLUMNS;
export const isField = (value: string): value is SheetField => Object.hasOwn(SHEET_COLUMNS, value);

/** One decoded sheet row; `row` is its sheet row number, a blank cell is absent. `name` and `holiday` are read-only. */
export type SheetRecord = {
	readonly row: number;
	readonly employee_number: string;
	readonly work_date: string;
	readonly shift_code?: string;
	/** Time-only text, an Excel serial, or a full native local/ISO timestamp. Midnight zero pairs record no work. */
	readonly clock_in?: string;
	readonly clock_out?: string;
	/** The day's overtime consent as written: Y, yes, true, 1, or a date (an ISO day or an Excel serial). */
	readonly overtime_consent?: string;
	readonly banked_overtime_hours?: number;
	readonly planned_overtime_hours?: number;
	/** Optional historical approval boundaries: full dated ISO timestamps with offsets; CLEAR in the first start removes them. */
	readonly approved_ot_1_start?: string;
	readonly approved_ot_1_end?: string;
	readonly approved_ot_2_start?: string;
	readonly approved_ot_2_end?: string;
	readonly approved_ot_1_break_minutes?: number;
	readonly approved_ot_2_break_minutes?: number;
	readonly leave_code?: string;
	readonly name?: string;
	readonly holiday?: string;
};

/** What the Work page shows: its entity (which resolves employee numbers) and its period (the template's days). */
export type SheetContext = {
	readonly company_id?: Id<'entity'> | null | undefined;
	readonly from?: PlainDate | null | undefined;
	readonly to?: PlainDate | null | undefined;
};

export type StoredInterval = NonNullable<Row<'roster_entry'>['worked_intervals']>[number];
export type ApprovedInterval = NonNullable<
	Row<'roster_entry'>['approved_overtime_intervals']
>[number];

/** The sheet's resolved keys and native values shared by the file sync's mapping and validation. */
export type SheetKnown = {
	/** Why nothing could be resolved (no such entity), or null. */
	readonly failure: string | null;
	readonly contracts: readonly {
		readonly id: Id<'employment_contract'>;
		readonly number: string;
		readonly company_id: Id<'entity'>;
		readonly from: PlainDate | null;
		readonly to: PlainDate | null;
		readonly zone: string;
	}[];
	readonly shifts: readonly {
		readonly id: Id<'shift_definition'>;
		readonly company_id: Id<'entity'>;
		readonly code: string;
		readonly from: PlainDate | null;
		readonly to: PlainDate | null;
	}[];
	/** `employment:date` → the leave class code recorded on the day. */
	readonly leave: { readonly [key: string]: string };
	/** `company:date` → the governing version's leave class ids by code, for the days the sheet names leave on. */
	readonly classes: { readonly [key: string]: { readonly [code: string]: Id<'leave_catalog'> } };
	/** `employment:date` → the stored intervals a row keeps (its clock matches them to the minute, or it has none). */
	readonly kept: { readonly [key: string]: readonly StoredInterval[] };
	/** `employment:date` → the stored `overtime_consented_at` (a mark or its own local day restates it). */
	readonly consented: { readonly [key: string]: Instant };
	/** An older ten-column upload keeps the planned overtime already recorded on its day. */
	readonly plannedOvertime?: { readonly [key: string]: number };
	/** Blank approval cells and older sheets preserve a stored day's approved windows. */
	readonly approvedOvertime?: { readonly [key: string]: readonly ApprovedInterval[] };
	/** Actual native pages already read by `known`; `check` consumes the same scope. */
	readonly checked?: {
		readonly rows: SheetScopeRead;
	};
};

/** A problem with a sheet row (`row` null: a stored day the sheet does not show), as the file sync reports it. */
export type SheetFinding = {
	readonly row: number | null;
	readonly column: string;
	readonly message: string;
	readonly severity: 'warn' | 'refuse';
};
