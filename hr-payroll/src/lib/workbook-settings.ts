/**
 * The `Settings` sheet every issued import workbook carries: one legal entity, one month,
 * and — for attendance — the IANA timezone its clock cells are local to.
 *
 * Keys are matched after the same normalisation the column headers use, so `Legal entity`
 * and `legal_entity` are the same row.
 */

import { Schema } from 'effect';
import {
	findSheet,
	WorkbookImportError,
	type SheetCell,
	type WorkbookGrids
} from './workbook-rows.js';
import { isYearMonth } from './period.js';

export const SETTINGS_SHEET_NAME = 'Settings';

const workbookSettingsSchema = Schema.Struct({
	legal_entity: Schema.optional(Schema.String),
	month: Schema.optional(Schema.String),
	timezone: Schema.optional(Schema.String)
});
type WorkbookSettings = Schema.Schema.Type<typeof workbookSettingsSchema>;

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

/** Every spelling the sheet accepts, against the setting it names. */
const SETTING_FIELDS = new Map<string, keyof WorkbookSettings>([
	['legal_entity', 'legal_entity'],
	['company', 'legal_entity'],
	['entity', 'legal_entity'],
	['company_name', 'legal_entity'],
	['month', 'month'],
	['roster_month', 'month'],
	['period', 'month'],
	['timezone', 'timezone'],
	['time_zone', 'timezone']
]);

/** Reads the Settings sheet when present. Missing keys stay absent rather than guessed. */
export function readWorkbookSettings(grids: WorkbookGrids): WorkbookSettings {
	const sheet = findSheet(grids, SETTINGS_SHEET_NAME);
	if (sheet == null) return {};

	const read: { -readonly [K in keyof WorkbookSettings]: string } = {};
	for (const cells of sheet) {
		const field = SETTING_FIELDS.get(settingKey(cells[0] ?? null));
		const value = settingValue(cells[1] ?? null);
		if (field == null || value == null) continue;
		read[field] = value;
	}
	const { legal_entity, month, timezone } = read;

	if (month != null && !isYearMonth(month)) {
		throw new WorkbookImportError(
			`The Settings sheet's month is "${month}", which is not a payroll month (YYYY-MM).`
		);
	}

	return { legal_entity, month, timezone };
}
