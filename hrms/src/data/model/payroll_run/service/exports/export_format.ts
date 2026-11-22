import type { InputFields } from '@norbital-ai/bolt';

/** One payroll row every export format consumes, already resolved from payslips and contracts. */
export interface PayrollExportRow {
	readonly payroll_run_id: string;
	readonly employee_number: string;
	readonly employee_name: string;
	readonly entity_name: string;
	readonly bank_name: string;
	readonly bank_code: string;
	readonly bank_account_number: string;
	readonly bank_account_name: string;
	readonly currency: string;
	readonly net_pay: number;
}

export type ExportRecord = Readonly<Record<string, string | number | null>>;

/** Every format module exposes the same shape, so a model sync is one line. */
export interface ExportFormat {
	readonly schema: InputFields;
	readonly parser: readonly ('xlsx' | 'txt')[];
	readonly records: (rows: readonly PayrollExportRow[]) => readonly ExportRecord[];
}

/** Fixed-width fields pad rather than truncate: a value too long is a configuration error, not a silent cut. */
export const fixed = (value: string | number, width: number, align: 'left' | 'right' = 'left') => {
	const text = String(value);
	if (text.length > width)
		throw new Error(`Export value '${text}' exceeds its ${width}-character field.`);
	return align === 'left' ? text.padEnd(width, ' ') : text.padStart(width, '0');
};
