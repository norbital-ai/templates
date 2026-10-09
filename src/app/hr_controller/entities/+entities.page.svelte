<script lang="ts">
	/**
	 * The legal entities this workspace operates, their holiday calendar, and the one-file holiday import:
	 * a workbook with one sheet per entity. Existing days are skipped; imported days land unpublished.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table, toast } from '@norbital-ai/ui';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import {
		parseEntityHolidaySheets,
		skipHeldHolidays
	} from '../../../lib/ui/workbook/holiday_workbook.js';
	import {
		runWorkbookImport,
		WorkbookImportError,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';

	const entities = liveRows(() =>
		bolt.read('entity', { select: { id: true, name: true }, all: true })
	);
	const holidays = liveRows(() =>
		bolt.read('holiday', { select: { company_id: true, date: true }, all: true })
	);

	function holidayRows(grids: WorkbookGrids): ActInput<'holiday.create'> {
		const parsed = parseEntityHolidaySheets(grids, entities.current ?? []);
		if ('error' in parsed) throw new WorkbookImportError(parsed.error, parsed.detail ?? []);
		const { insert } = skipHeldHolidays(parsed.rows, holidays.current ?? []);
		if (insert.length === 0) throw new WorkbookImportError('This file has no holidays to import.');
		return insert.map((row) => ({
			company_id: row.company_id,
			date: PlainDate(row.date),
			name: row.name,
			kind: row.kind,
			...(row.replaces == null ? {} : { replaces: PlainDate(row.replaces) })
		}));
	}

	let importing = $state(false);
	async function importHolidays() {
		importing = true;
		await runWorkbookImport({
			action: 'holiday.create',
			recordLabel: bolt.t('app.settings.holidays').toLowerCase(),
			buildPayload: holidayRows,
			importedCount: (payload) => (Array.isArray(payload) ? payload.length : 1)
		});
		importing = false;
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
				'registration_number',
				{ field: 'settings_code', label: bolt.t('component.settings_lineage') },
				{ field: 'pay_cutoff_day', label: bolt.t('app.settings.cutoff_day') },
				{ field: 'pay_frequency', label: bolt.t('component.pay_frequency') },
				{ field: 'effective_range', label: bolt.t('component.effective') }
			]}
		/>
	</Stack>
</AppShell>
