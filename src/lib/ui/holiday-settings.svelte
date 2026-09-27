<script lang="ts">
	/**
	 * One table, one entity, one year: the holidays themselves, each published on its own.
	 *
	 * Holidays belong to the employer, not the country — two entities in one jurisdiction keep
	 * different calendars — so the table is entity-scoped and its Google source is the entity's.
	 * The year is a scope rather than a filter: a calendar is maintained a year at a time.
	 *
	 * Publishing and unpublishing are updates of the rows a person selected; the spreadsheet import is
	 * the collection's `import_workbook` action and the Google calendar the `holiday_import`
	 * automation, both through the same dedupe, so a day the entity already has is never duplicated.
	 * A holiday a payroll run captured is frozen: its collection refuses the change.
	 */
	import { t } from './t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { Combobox, Table } from '@norbital-ai/ui';
	import { holidayCompanyImportPayload } from '../holiday-workbook.js';
	import { formatCalendarDate } from './display-formatters.js';
	import { runWorkbookImport } from './workbook-import.js';

	let { company }: { company: { readonly id: Id<'companies'>; readonly name: string } } = $props();
	const thisYear = new Date().getFullYear();
	let year = $state(thisYear);
	/** Three years back for corrections, next year for the calendar the Google import fills. */
	const years = Array.from({ length: 5 }, (_, index) => thisYear - 3 + index);
	let importing = $state(false);
	async function importSpreadsheet() {
		importing = true;
		await runWorkbookImport({
			action: 'jurisdiction_holidays.import_workbook',
			recordLabel: t('app.settings.holidays').toLowerCase(),
			buildPayload: holidayCompanyImportPayload(company.name),
			importedCount: (_payload, output) => output.inserted
		});
		importing = false;
	}
	const publication = (published: boolean) => (ids: Id<'jurisdiction_holidays'>[]) =>
		ids.map((id) => ({
			target: id,
			set: { published_at: published ? Instant(new Date()) : null }
		}));
</script>

{#snippet dayCell({ value }: { value: unknown })}{formatCalendarDate(value)}{/snippet}

{#snippet yearPicker()}
	<Combobox
		class="w-28"
		size="sm"
		aria-label={t('holiday_calendar.year')}
		options={years.map((option) => ({ value: String(option), label: String(option) }))}
		value={String(year)}
		onChange={(next) => next != null && (year = Number(next))}
	/>
{/snippet}

<!-- the year is the toolbar's scope control; the imports are its actions (the Google run's progress shows under it) -->
{#key year}
	<Table
		of="jurisdiction_holidays"
		key={`holidays-${company.id}-${year}`}
		toolbar={{
			title: t('app.settings.holidays'),
			controls: yearPicker,
			actions: [
				{
					start: 'holiday_import',
					input: () => ({ company_id: company.id, year }),
					group: 'import',
					icon: 'lucide:calendar-sync',
					label: t('holiday_import.google'),
					description: t('holiday_import.google_description')
				},
				{
					run: importSpreadsheet,
					group: 'import',
					icon: 'lucide:file-spreadsheet',
					label: t('holiday_import.spreadsheet'),
					description: t('holiday_import.spreadsheet_description'),
					disabled: () => (importing ? t('component.loading') : null)
				},
				{
					action: 'jurisdiction_holidays.update',
					input: publication(true),
					label: t('holiday_calendar.publish_selected'),
					requiresSelection: true
				},
				{
					action: 'jurisdiction_holidays.update',
					input: publication(false),
					label: t('holiday_calendar.unpublish_selected'),
					requiresSelection: true
				}
			]
		}}
		where={{
			company_id: { eq: company.id },
			date: { gte: `${year}-01-01`, lte: `${year}-12-31` },
			approval_id: { isNull: true }
		}}
		orderBy={{ date: 'asc' }}
		columns={[
			{ field: 'date', label: t('component.observed_on'), cell: dayCell },
			{ field: 'name', label: t('component.holiday') },
			{ field: 'kind', label: t('holiday_calendar.kind') },
			{ field: 'replaces', label: t('holiday_calendar.replaces'), cell: dayCell },
			{ field: 'published_at', label: t('holiday_calendar.published_at') }
		]}
	/>
{/key}
