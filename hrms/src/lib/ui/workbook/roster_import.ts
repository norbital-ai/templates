import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { month_of, plain_date } from '../../date.js';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type { PageContext } from '@norbital-ai/bolt/page';
import {
	planRosterUpload,
	rosterMonth,
	rosterSheets,
	type RosterDay,
	type RosterEmployee,
	type RosterShift,
	type RosterStored
} from '../../payroll_engine/roster_workbook.js';
import {
	WorkbookImportError,
	runWorkbookImportSteps,
	workbookImportError
} from './workbook_import.js';

const zoneOn = <V>(
	versions: readonly V[],
	day: string,
	rangeOf: (version: V) => { readonly from: string; readonly to: string | null },
	zoneOf: (version: V) => string | null | undefined
): string | null => {
	const last = versions
		.filter((version) => {
			const range = rangeOf(version);
			return range.from <= day && (range.to == null || day <= range.to);
		})
		.toSorted((left, right) => rangeOf(left).from.localeCompare(rangeOf(right).from))
		.at(-1);
	return last == null ? null : (zoneOf(last) ?? null);
};

/**
 * Reads one roster workbook for the scoped entity and writes what it changes as one import: a dry run first, whose
 * refusal lists every row the server refuses and writes nothing, then the import itself.
 */
export const runRosterImport = (
	ctx: Pick<PageContext, 't' | 'act' | 'query'>,
	options: {
		readonly entity_id: Id<'entity'>;
		readonly entity_name: string;
		readonly settings_code: string;
	}
) =>
	runWorkbookImportSteps(ctx, {
		recordLabel: ctx.t('models.roster_entry.label').toLowerCase(),
		buildPayload: (grids) =>
			Effect.gen(function* () {
				const month = yield* Effect.try({
					try: () => rosterMonth(grids),
					catch: workbookImportError
				});
				const day = plain_date(`${month}-01`);
				const scope = yield* ctx.query({
					employee_contract: {
						where: { entity_id: { eq: options.entity_id }, status: { eq: 'SEALED' } },
						fields: ['employee_number', 'entity_id', 'effective_range'],
						limit: 10000
					},
					shift_definition: {
						where: { entity_id: { eq: options.entity_id } },
						fields: ['code', 'entity_id', 'effective_range', 'variant'],
						limit: 10000
					},
					entity_profile_version: {
						where: { entity_id: { eq: options.entity_id }, status: { eq: 'SEALED' } },
						fields: ['effective_range', 'time_zone'],
						limit: 10000
					},
					jurisdiction_settings: {
						where: { code: { eq: options.settings_code }, status: { eq: 'SEALED' } },
						fields: ['effective_range', 'timezone'],
						limit: 10000
					}
				});
				const zone =
					zoneOn(
						scope.entity_profile_version.rows,
						day,
						(version) => version.effective_range,
						(version) => version.time_zone
					) ??
					zoneOn(
						scope.jurisdiction_settings.rows,
						day,
						(version) => version.effective_range,
						(version) => version.timezone
					);
				if (zone == null)
					return yield* Effect.fail(
						workbookImportError(
							`No sealed employer or jurisdiction version covers ${day}; the month's time zone is unknown.`
						)
					);
				const entries =
					scope.employee_contract.rows.length === 0
						? []
						: (yield* ctx.query({
								roster_entry: {
									where: {
										employment_id: {
											in: scope.employee_contract.rows.map((row) => row.id)
										},
										work_date: { gte: day, lte: month_of(day).to ?? day }
									},
									fields: [
										'employment_id',
										'work_date',
										'shift_definition_id',
										'planned_overtime_intervals',
										'overtime_as_time_off',
										'actual_worked_intervals',
										'consent'
									],
									limit: 10000
								}
							})).roster_entry.rows;
				const employees: RosterEmployee[] = scope.employee_contract.rows.map((row) => ({
					id: row.id,
					number: row.employee_number,
					entity_id: row.entity_id,
					from: row.effective_range.from,
					to: row.effective_range.to
				}));
				const shifts: RosterShift[] = scope.shift_definition.rows.map((row) => ({
					id: row.id,
					entity_id: row.entity_id,
					code: row.code,
					from: row.effective_range?.from ?? null,
					to: row.effective_range?.to ?? null,
					start_time: row.variant.start_time ?? null,
					end_time: row.variant.end_time ?? null,
					ends_next_day: row.variant.ends_next_day === true
				}));
				const stored: RosterStored[] = entries.map((entry) => ({
					employment_id: entry.employment_id,
					work_date: String(entry.work_date),
					shift_definition_id: entry.shift_definition_id,
					planned_overtime_intervals: entry.planned_overtime_intervals ?? null,
					overtime_as_time_off: entry.overtime_as_time_off,
					actual_worked_intervals: (entry.actual_worked_intervals ?? []).flatMap((interval) =>
						interval.end == null ? [] : [{ start: interval.start, end: interval.end }]
					),
					consent: entry.consent ?? null
				}));
				return yield* Effect.try({
					try: () =>
						planRosterUpload(grids, {
							entity_name: options.entity_name,
							zone,
							employees,
							shifts,
							entries: stored
						}),
					catch: workbookImportError
				});
			}).pipe(Effect.mapError(workbookImportError)),
		submit: (plan) => {
			const input = { rows: plan.rows, on_conflict: 'update' } as const;
			// the server judges the whole file through the write itself, then writes all of it or nothing
			return ctx.act({ 'roster_entry.import': { ...input, dry_run: true as const } }).pipe(
				Effect.andThen(ctx.act({ 'roster_entry.import': input })),
				Effect.as({
					imported: plan.rows.length,
					overwritten: plan.overwritten,
					warnings: plan.warnings
				}),
				Effect.catchTag('ActRefused', (refused) =>
					Effect.fail(
						new WorkbookImportError({
							message: ctx.t('roster.import_refused'),
							detail: refused.message.split('\n')
						})
					)
				),
				Effect.catchTag('ActUnknown', () =>
					Effect.fail(
						new WorkbookImportError({ message: ctx.t('roster.import_interrupted'), detail: [] })
					)
				)
			);
		}
	});

/** The month as its two sheets: what the board shows, ready to fill in and import. */
export const downloadRosterWorkbook = async (
	month: string,
	rows: readonly RosterDay[],
	zone: string
) => {
	const workbook = new ExcelJSBrowser.Workbook();
	for (const [name, cells] of rosterSheets(rows, zone)) {
		const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
		sheet.addRows(cells.map((row) => [...row]));
		sheet.getRow(1).font = { bold: true };
		sheet.columns.forEach((column) => {
			column.width = 18;
			// text, so Excel leaves `08:30` and `2026-06-03` exactly as they are written
			column.numFmt = '@';
		});
	}
	const bytes = await workbook.xlsx.writeBuffer();
	const url = URL.createObjectURL(
		new Blob([new Uint8Array(bytes)], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		})
	);
	Object.assign(document.createElement('a'), {
		href: url,
		download: `roster-${month}.xlsx`
	}).click();
	URL.revokeObjectURL(url);
};
