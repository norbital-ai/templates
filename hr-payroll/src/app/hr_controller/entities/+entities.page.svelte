<script lang="ts">
	/**
	 * The legal entities this workspace operates, and the one-file holiday import: a workbook with one sheet per
	 * entity, each resolved to its entity by name on the server.
	 */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import { Toaster } from 'svelte-sonner';
	import { holidayBulkImportPayload } from '../../../lib/payroll_engine/services.js';
	import { runWorkbookImport } from '../../../lib/ui/workbook/workbook-import.js';

	let importing = $state(false);
	async function importHolidays() {
		importing = true;
		await runWorkbookImport({
			action: 'holidays.import_workbook',
			recordLabel: bolt.t('app.settings.holidays').toLowerCase(),
			buildPayload: holidayBulkImportPayload,
			importedCount: (_payload, output) => output.inserted
		});
		importing = false;
	}
</script>

<Toaster />
<AppShell
	icon="lucide:building-2"
	title={bolt.t('app.hr_controller.entities_title')}
	description={bolt.t('app.hr_controller.entities_description')}
>
	<Table
		of="entities"
		key="entities"
		toolbar={{
			title: bolt.t('app.hr_controller.entities_title'),
			actions: [
				{
					run: importHolidays,
					group: 'import',
					icon: 'lucide:file-spreadsheet',
					label: bolt.t('holiday_import.spreadsheet'),
					description: bolt.t('holiday_import.spreadsheet_description'),
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
</AppShell>
