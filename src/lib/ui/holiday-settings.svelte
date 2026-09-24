<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { formatCalendarInstant } from './display-formatters.js';
	import { Effect } from 'effect';
	import { setContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { HOLIDAY_COMPANY } from '../holiday-scope.js';
	import { dayInstant } from '../iso-day.js';
	import { holidayCompanyImportPayload } from '../holiday-workbook.js';
	import { runWorkbookImport } from './workbook-import.js';
	import { importCollectionRecords } from '@norbital-ai/bolt/client';
	import type { WorkspaceRow } from '$bolt/types.js';

	/**
	 * One table, one entity, one year: the holidays themselves, each published on its own.
	 *
	 * Holidays belong to the employer, not the country — two entities in one jurisdiction keep
	 * different calendars — so the table is entity-scoped and its Google source is the entity's.
	 * The year is a scope rather than a filter: a calendar is maintained a year at a time, and a
	 * table showing every year at once is a table nobody can check against a gazette. It is picked
	 * in the table's navigation, like every other scope in the catalogues.
	 *
	 * Create, search and filter are the table's; publishing is a bulk operation over the rows a
	 * person selected, and the spreadsheet import a pipeline — both go through the collection's own
	 * import handler, so no write is made from the browser. The Google calendar set on the entity
	 * comes through the same dedupe, so a day the entity already has is never duplicated. A holiday
	 * a payroll run captured is frozen; unpublishing or deleting one is refused while a run holds
	 * it, and the pinning work days are re-saved first otherwise. Published is the status column.
	 */
	let { company }: { company: WorkspaceRow<'companies'> } = $props();
	const companyId = $derived(company.id);
	const { t } = useI18n<TenantI18nKeys>();
	// The create form opened from this table starts on this entity.
	setContext(HOLIDAY_COMPANY, () => companyId);

	const thisYear = new Date().getFullYear();
	let year = $state(thisYear);
	/** Three years back for corrections, next year for the calendar the Google import fills. */
	const yearOptions = Array.from({ length: 5 }, (_, index) => {
		const value = String(thisYear - 3 + index);
		return { value, label: value };
	});
	const yearRange = $derived({
		start: dayInstant(`${year}-01-01`),
		end: dayInstant(`${year}-12-31`)
	});

	type Holiday = WorkspaceRow<'jurisdiction_holidays'>;
	/**
	 * Publication for selected rows goes through the collection's import handler, which answers
	 * with the rows to write; the toolbar's operations are the only writer this surface has.
	 */
	const publication = (rows: readonly Holiday[], published: boolean) =>
		Effect.tryPromise({
			try: () =>
				importCollectionRecords({
					records: [
						{
							collection: 'jurisdiction_holidays',
							id: crypto.randomUUID(),
							values: { publish: rows.map((row) => row.id), published }
						}
					]
				}),
			catch: (cause) => new Error(getErrorMessage(cause))
		}).pipe(
			Effect.tap((count) =>
				Effect.sync(() =>
					toast.success(
						t(
							published ? 'holiday_calendar.published_count' : 'holiday_calendar.unpublished_count',
							{
								count
							}
						)
					)
				)
			)
		);

	/**
	 * The vault's projection is a management command the tenant client does not carry, so the
	 * refusal for want of the key is translated rather than pre-flighted.
	 */
	const keyUnset = (message: string): string =>
		/GOOGLE_CALENDAR_API_KEY.*vault has no value/.test(message)
			? t('holiday_import.configure_key')
			: message;
</script>

{#snippet yearScope()}
	<Combobox
		options={yearOptions}
		value={String(year)}
		onValueChange={(next) => {
			if (next != null) year = Number(next);
		}}
		allowClear={false}
		preserveOptionOrder
		ariaLabel={t('holiday_calendar.year')}
		class="w-28"
	/>
{/snippet}

<CollectionTable
	{client}
	collection="jurisdiction_holidays"
	view="hr_controller:settings:holidays"
	title={t('app.settings.holidays')}
	description={t('holiday_calendar.description')}
	navigation={yearScope}
	query={{
		where: {
			company_id: { eq: companyId },
			date: { gte: yearRange.start, lte: yearRange.end },
			approval_id: { isNull: true }
		},
		orderBy: { date: 'asc' }
	}}
	bulkPipelines={[
		{
			id: 'holidays-publish',
			label: t('holiday_calendar.publish_selected'),
			description: t('holiday_calendar.publish_selected_description'),
			icon: 'lucide:calendar-check',
			requiresSelection: true,
			run: ({ selectedRows }) => publication(selectedRows, true)
		},
		{
			id: 'holidays-unpublish',
			label: t('holiday_calendar.unpublish_selected'),
			description: t('holiday_calendar.unpublish_selected_description'),
			icon: 'lucide:calendar-minus',
			requiresSelection: true,
			run: ({ selectedRows }) => publication(selectedRows, false)
		}
	]}
	importPipelines={[
		{
			id: 'holidays-google',
			label: t('holiday_import.google'),
			description: t('holiday_import.google_description'),
			icon: 'lucide:calendar-sync',
			// Inline, not a script helper: a client write is a command at its call site.
			run: () =>
				Effect.tryPromise({
					try: () => client.automations.holiday_import.run({ company_id: companyId, year }),
					catch: (cause) => new Error(keyUnset(getErrorMessage(cause)))
				}).pipe(
					Effect.flatMap((run) =>
						run.current?.status === 'failed'
							? Effect.fail(new Error(keyUnset(run.current.error ?? '')))
							: Effect.sync(() => toast.success(t('holiday_import.started')))
					)
				)
		},
		{
			id: 'holidays-workbook',
			label: t('holiday_import.spreadsheet'),
			description: t('holiday_import.spreadsheet_description'),
			icon: 'lucide:upload',
			run: () =>
				runWorkbookImport(
					{
						collectionName: 'jurisdiction_holidays',
						recordLabel: t('app.settings.holidays').toLowerCase(),
						buildPayload: (grids) => holidayCompanyImportPayload(company.name)(grids)
					},
					t
				)
		}
	]}
>
	{#snippet columns({ Column })}
		<!-- Holiday days are payroll-zone midnights; the default day renderer reads them in UTC, a day early. -->
		<Column
			name="date"
			label={t('component.observed_on')}
			card="title"
			renderer={FormattedValueRenderer}
			rendererProps={{
				format: ({ row }: { row: { date: unknown } }) => formatCalendarInstant(row.date)
			}}
		/>
		<Column name="name" label={t('component.holiday')} card="subtitle" />
		<Column name="kind" label={t('holiday_calendar.kind')} />
		<Column
			name="replaces"
			label={t('holiday_calendar.replaces')}
			renderer={FormattedValueRenderer}
			rendererProps={{
				format: ({ row }: { row: { replaces: unknown } }) => formatCalendarInstant(row.replaces)
			}}
		/>
		<Column name="published_at" label={t('holiday_calendar.published_at')} card="badge" />
	{/snippet}
</CollectionTable>
