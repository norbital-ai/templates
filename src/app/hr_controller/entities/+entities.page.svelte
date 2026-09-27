<script lang="ts">
	/**
	 * The legal entities this workspace operates, and the one-file holiday import: a workbook with one sheet per
	 * entity, each resolved to its entity by name on the server.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import { Toaster } from 'svelte-sonner';
	import { holidayBulkImportPayload } from '../../../lib/holiday-workbook.js';
	import { runWorkbookImport } from '../../../lib/ui/workbook-import.js';

	let importing = $state(false);
	async function importHolidays() {
		importing = true;
		await runWorkbookImport({
			action: 'jurisdiction_holidays.import_workbook',
			recordLabel: t('app.settings.holidays').toLowerCase(),
			buildPayload: holidayBulkImportPayload,
			importedCount: (_payload, output) => output.inserted
		});
		importing = false;
	}
</script>

<Toaster />
<AppShell
	icon="lucide:building-2"
	title={t('app.hr_controller.entities_title')}
	description={t('app.hr_controller.entities_description')}
>
	<Table
		of="companies"
		key="entities"
		toolbar={{
			title: t('app.hr_controller.entities_title'),
			actions: [
				{
					run: importHolidays,
					group: 'import',
					icon: 'lucide:file-spreadsheet',
					label: t('holiday_import.spreadsheet'),
					description: t('holiday_import.spreadsheet_description'),
					disabled: () => (importing ? t('component.loading') : null)
				}
			]
		}}
		orderBy={{ name: 'asc' }}
		columns={[
			'name',
			'registration_number',
			{ field: 'settings_code', label: t('component.settings_lineage') },
			{ field: 'pay_cutoff_day', label: t('app.settings.cutoff_day') },
			{ field: 'pay_frequency', label: t('component.pay_frequency') },
			{ field: 'effective_range', label: t('component.effective') }
		]}
	/>
</AppShell>
