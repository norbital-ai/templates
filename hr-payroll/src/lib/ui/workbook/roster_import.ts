import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { PlainDate, monthOf } from '@norbital-ai/std/date';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { bolt } from '$bolt';
import { toast } from '@norbital-ai/ui';
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
 * Reads one roster workbook for the scoped entity and writes what it changes: whole-roster creates
 * first, then one bounded update per existing roster. A sealed day is refused by the plan before
 * either call, naming the payroll run.
 */
export const runRosterImport = (options: {
	readonly entity_id: Id<'entity'>;
	readonly entity_name: string;
	readonly settings_code: string;
}) =>
	runWorkbookImportSteps({
		recordLabel: bolt.t('models.roster_entry.label').toLowerCase(),
		buildPayload: (grids) =>
			Effect.gen(function* () {
				const month = yield* Effect.try({
					try: () => rosterMonth(grids),
					catch: workbookImportError
				});
				const day = PlainDate(`${month}-01`);
				const scope = yield* bolt.query({
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
						: (yield* bolt.query({
								roster_entry: {
									where: {
										employment_id: {
											in: scope.employee_contract.rows.map((row) => row.id)
										},
										work_date: { gte: day, lte: monthOf(day).to ?? day }
									},
									fields: [
										'employment_id',
										'work_date',
										'shift_definition_id',
										'planned_overtime_intervals',
										'actual_worked_intervals',
										'consent',
										'payroll_run_id'
									],
									limit: 10000
								}
							})).roster_entry.rows;
				const runIds = [
					...new Set(
						entries.flatMap((entry) => (entry.payroll_run_id == null ? [] : [entry.payroll_run_id]))
					)
				];
				const runs =
					runIds.length === 0
						? []
						: (yield* bolt.query({
								payroll_run: {
									where: { id: { in: runIds } },
									fields: ['run_number', 'period'],
									limit: 10000
								}
							})).payroll_run.rows;
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
				const stored: RosterStored[] = entries.map((entry) => {
					const run = runs.find((candidate) => candidate.id === entry.payroll_run_id);
					return {
						id: entry.id,
						employment_id: entry.employment_id,
						work_date: String(entry.work_date),
						shift_definition_id: entry.shift_definition_id,
						planned_overtime_intervals: entry.planned_overtime_intervals ?? null,
						actual_worked_intervals: (entry.actual_worked_intervals ?? []).flatMap((interval) =>
							interval.end == null ? [] : [{ start: interval.start, end: interval.end }]
						),
						consent: entry.consent ?? null,
						payroll_run_id: entry.payroll_run_id ?? null,
						run_label: run?.run_number == null ? null : String(run.run_number)
					};
				});
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
		submit: (plan) =>
			Effect.gen(function* () {
				const byEmployment = <T extends { readonly employment_id: string }>(rows: readonly T[]) => {
					const groups = new Map<string, T[]>();
					for (const row of rows) {
						const group = groups.get(row.employment_id) ?? [];
						group.push(row);
						groups.set(row.employment_id, group);
					}
					return [...groups.values()];
				};
				const creates = byEmployment(plan.creates);
				const updates = byEmployment(plan.updates);
				const total = creates.length + updates.length;
				const notice = (done: number) =>
					toast.info(bolt.t('roster.importing', { done, total }), { duration: 600_000 });
				let done = 0;
				let shown = notice(0);
				const written = Effect.sync(() => {
					done += 1;
					if (done % 10 !== 0) return;
					toast.dismiss(shown);
					shown = notice(done);
				});
				yield* Effect.forEach(
					creates,
					(group) => bolt.act('roster_entry.create', group).pipe(Effect.andThen(written)),
					{ concurrency: 4, discard: true }
				).pipe(
					Effect.andThen(
						Effect.forEach(
							updates,
							(group) =>
								bolt
									.act(
										'roster_entry.update',
										group.map((update) => ({ target: update.target, set: update.set }))
									)
									.pipe(Effect.andThen(written)),
							{ concurrency: 4, discard: true }
						)
					),
					Effect.catchTag('ActUnknown', () =>
						Effect.fail(
							new WorkbookImportError({ message: bolt.t('roster.import_interrupted'), detail: [] })
						)
					),
					Effect.ensuring(Effect.sync(() => toast.dismiss(shown)))
				);
				return {
					imported: plan.count,
					overwritten: plan.overwritten,
					warnings: plan.warnings
				};
			})
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
