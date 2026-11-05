<script lang="ts">
	/**
	 * The legal entities this workspace operates, their holiday calendar, and the one-file holiday import:
	 * a workbook with one sheet per entity. Existing days are skipped; imported days land unpublished.
	 */
	import { bolt } from '$bolt';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table, toast } from '@norbital-ai/ui';
	import {
		parseEntityHolidaySheets,
		skipHeldHolidays
	} from '../../../lib/ui/workbook/holiday_workbook.js';
	import {
		runWorkbookImport,
		WorkbookImportError,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	import { importDataRequest } from '../../../lib/ui/workbook/data_request_import.js';

	const held = $derived.by(() =>
		bolt.query({ entity: { fields: ['name'] }, holiday: { fields: ['entity_id', 'date'] } })
	);

	function holidayRows(grids: WorkbookGrids): ActInput<'holiday.create'> {
		const parsed = parseEntityHolidaySheets(grids, held?.current?.entity.rows ?? []);
		if ('error' in parsed)
			throw new WorkbookImportError({ message: parsed.error, detail: parsed.detail ?? [] });
		const { insert } = skipHeldHolidays(parsed.rows, held?.current?.holiday.rows ?? []);
		if (insert.length === 0)
			throw new WorkbookImportError({
				message: 'This file has no holidays to import.',
				detail: []
			});
		return insert.map((row) => ({
			entity_id: row.entity_id,
			date: PlainDate(row.date),
			name: row.name,
			kind: row.kind,
			...(row.replaces == null ? {} : { replaces: PlainDate(row.replaces) })
		}));
	}

	let importing = $state(false);
	function importRequest() {
		importing = true;
		fork(importDataRequest().pipe(Effect.ensuring(Effect.sync(() => (importing = false)))));
	}
	function importHolidays() {
		importing = true;
		fork(
			runWorkbookImport({
				action: 'holiday.create',
				recordLabel: bolt.t('app.settings.holidays').toLowerCase(),
				buildPayload: holidayRows,
				importedCount: (payload) => payload.length
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importing = false;
					})
				)
			)
		);
	}
</script>

<AppShell
	icon="lucide:building-2"
	title={bolt.t('app.hr_controller.entities_title')}
	description={bolt.t('app.hr_controller.entities_description')}
>
	<Stack gap="lg">
		<Table
			of="entity"
			key="entity"
			toolbar={{
				title: bolt.t('app.hr_controller.entities_title'),
				actions: [
					{
						run: importRequest,
						icon: 'lucide:file-up',
						name: bolt.t('data_request.import'),
						description: bolt.t('data_request.import_description'),
						disabled: () => (importing ? bolt.t('component.loading') : null)
					},
					{
						run: importHolidays,
						icon: 'lucide:file-spreadsheet',
						name: bolt.t('holiday_calendar.import_spreadsheet'),
						description: bolt.t('holiday_calendar.import_spreadsheet_description'),
						disabled: () => (importing ? bolt.t('component.loading') : null)
					}
				]
			}}
			orderBy={{ name: 'asc' }}
			columns={[
				'name',
				{ field: 'settings_code', label: bolt.t('component.settings_lineage') },
				'payroll_versions'
			]}
		/>
	</Stack>
</AppShell>
