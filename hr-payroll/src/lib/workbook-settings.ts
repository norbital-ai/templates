/**
 * The `Settings` sheet every issued import workbook carries: one legal entity, one month,
 * and — for attendance — the IANA timezone its clock cells are local to.
 *
 * Keys are matched after the same normalisation the column headers use, so `Legal entity`
 * and `legal_entity` are the same row.
 */

import {
	findSheet,
	WorkbookImportError,
	type SheetCell,
	type WorkbookGrids
} from './workbook-rows.js';
import { isYearMonth } from './period.js';

export const SETTINGS_SHEET_NAME = 'Settings';

export interface WorkbookSettings {
	readonly legal_entity?: string;
	readonly month?: string;
	readonly timezone?: string;
}

function settingKey(cell: SheetCell): string {
	return String(cell ?? '')
		.trim()
		.toLowerCase()
		.replaceAll(/[\s-]+/g, '_');
}

function settingValue(cell: SheetCell): string | undefined {
	if (cell == null) return undefined;
	const text = String(cell).trim();
	return text === '' ? undefined : text;
}

const LEGAL_ENTITY_KEYS = new Set(['legal_entity', 'company', 'entity', 'company_name']);
const MONTH_KEYS = new Set(['month', 'roster_month', 'period']);
const TIMEZONE_KEYS = new Set(['timezone', 'time_zone']);

/** Reads the Settings sheet when present. Missing keys stay absent rather than guessed. */
export function readWorkbookSettings(grids: WorkbookGrids): WorkbookSettings {
	const sheet = findSheet(grids, SETTINGS_SHEET_NAME);
	if (sheet == null) return {};

	let legal_entity: string | undefined;
	let month: string | undefined;
	let timezone: string | undefined;
	for (const cells of sheet) {
		const key = settingKey(cells[0] ?? null);
		const value = settingValue(cells[1] ?? null);
		if (value == null) continue;
		if (LEGAL_ENTITY_KEYS.has(key)) legal_entity = value;
		else if (MONTH_KEYS.has(key)) month = value;
		else if (TIMEZONE_KEYS.has(key)) timezone = value;
	}

	if (month != null && !isYearMonth(month)) {
		throw new WorkbookImportError(
			`The Settings sheet's month is "${month}", which is not a payroll month (YYYY-MM).`
		);
	}

	return { legal_entity, month, timezone };
}
