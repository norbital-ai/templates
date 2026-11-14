<script lang="ts">
	import { watch } from 'runed';
	/**
	 * The legal entities this workspace operates, their holiday calendar, and the one-file holiday import:
	 * a workbook with one sheet per entity. Existing days are skipped; imported days land unpublished.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput } from '@norbital-ai/bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
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
	let { ctx }: { ctx: PageContext } = $props();

	// read when the page opens, so an import knows the holidays already on file
	const held = ctx.query({
		entity: { fields: ['name'] },
		holiday: { fields: ['entity_id', 'date'], limit: 10000 }
	});
	watch(
		() => held.current,
		() => {}
	);

	function holidayRows(grids: WorkbookGrids): ActInput<'holiday.create'> {
		const parsed = parseEntityHolidaySheets(grids, held.current?.entity.rows ?? []);
		if ('error' in parsed)
			throw new WorkbookImportError({ message: parsed.error, detail: parsed.detail ?? [] });
		const { insert } = skipHeldHolidays(parsed.rows, held.current?.holiday.rows ?? []);
		if (insert.length === 0)
			throw new WorkbookImportError({
				message: 'This file has no holidays to import.',
				detail: []
			});
		return insert.map((row) => ({
			entity_id: row.entity_id,
			date: row.date,
			name: row.name,
			kind: row.kind,
			...(row.replaces == null ? {} : { replaces: row.replaces })
		}));
	}

	let importing = $state(false);
	function importRequest() {
		importing = true;
		fork(importDataRequest(ctx).pipe(Effect.ensuring(Effect.sync(() => (importing = false)))));
	}
	function importHolidays() {
		importing = true;
		fork(
			runWorkbookImport(ctx, {
				action: 'holiday.create',
				recordLabel: ctx.t('app.settings.holidays').toLowerCase(),
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
	title={ctx.t('app.hr_controller.entities_title')}
	description={ctx.t('app.hr_controller.entities_description')}
>
	<Table
		{ctx}
		of="entity"
		key="entity"
		toolbar={{
			title: ctx.t('app.hr_controller.entities_title'),
			actions: [
				{
					run: importRequest,
					icon: 'lucide:file-up',
					name: ctx.t('data_request.import'),
					description: ctx.t('data_request.import_description'),
					disabled: () => (importing ? ctx.t('component.loading') : null)
				},
				{
					run: importHolidays,
					icon: 'lucide:file-spreadsheet',
					name: ctx.t('holiday_calendar.import_spreadsheet'),
					description: ctx.t('holiday_calendar.import_spreadsheet_description'),
					disabled: () => (importing ? ctx.t('component.loading') : null)
				}
			]
		}}
		order_by={{ name: 'asc' }}
		columns={['name', { field: 'settings_code', label: ctx.t('component.settings_lineage') }]}
	/>
</AppShell>
