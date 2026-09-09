<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Cluster, Cover } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { setContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { HOLIDAY_JURISDICTION } from '../holiday-scope.js';
	import { holidayImportPayload } from '../holiday-workbook.js';
	import { runWorkbookImport } from './workbook-import.js';
	import type { WorkspaceRow } from '$bolt/types.js';

	/**
	 * One table, one jurisdiction: the holidays themselves, each published on its own. Create,
	 * search and filter are the table's; the two imports are its pipelines — a spreadsheet, or
	 * the Google calendar set under General — and both come through the same door, so a day the
	 * jurisdiction already has is never duplicated. A holiday a work day or payroll run has read
	 * is frozen and says so.
	 */
	let { version }: { version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const jurisdictionCode = $derived(version.jurisdiction_code);
	const { t } = useI18n<TenantI18nKeys>();
	// The create form opened from this table starts on this jurisdiction.
	setContext(HOLIDAY_JURISDICTION, () => jurisdictionCode);

	type Holiday = WorkspaceRow<'jurisdiction_holidays'>;

	let importing = $state(false);
	let importNote = $state<string | null>(null);
	/**
	 * The run this surface started, held here rather than read back off the client: the client's
	 * `latest` is set on a host-side signal a `$derived` in authored code never re-reads. The run's
	 * own snapshot is live, so the note below follows the import to its last word.
	 */
	let latestRun =
		$state<
			ReturnType<typeof client.automations.holiday_import.run> extends Promise<infer R> ? R : never
		>();
	/**
	 * The one way this surface learns the key is unset: the import refused for want of it. The
	 * vault's own projection is a management command the tenant client does not carry, so the
	 * sentence stands in for the refusal rather than a pre-flight read.
	 */
	const keyUnset = (message: string): string =>
		/GOOGLE_CALENDAR_API_KEY.*vault has no value/.test(message)
			? t('holiday_import.configure_key')
			: message;
</script>

{#snippet publishAction({ row, hovered }: { row: Holiday; hovered: boolean })}
	{#if row.consumed_at != null}
		<span class="text-xs text-muted-foreground">{t('holiday_calendar.consumed')}</span>
	{:else if hovered || row.published_at == null}
		<Button
			size="sm"
			variant={row.published_at == null ? 'default' : 'ghost'}
			onclick={(event) => {
				event.stopPropagation();
				const published = row.published_at == null;
				Effect.runFork(
					submitCollectionMutation(() =>
						client.db.jurisdiction_holidays.mutate([
							{ id: row.id, published_at: published ? new Date().toISOString() : null }
						])
					).pipe(Effect.catch((cause) => Effect.sync(() => toast.error(getErrorMessage(cause)))))
				);
			}}
			>{row.published_at == null
				? t('holiday_calendar.publish')
				: t('holiday_calendar.unpublish')}</Button
		>
	{/if}
{/snippet}

{#snippet googleImport()}
	<Cluster align="center" gap="sm">
		<Button
			size="sm"
			variant="outline"
			disabled={importing}
			title={t('holiday_import.google_description')}
			onclick={async () => {
				importing = true;
				importNote = null;
				latestRun = undefined;
				try {
					latestRun = await client.automations.holiday_import.run({
						jurisdiction_code: jurisdictionCode,
						year: new Date().getFullYear() + 1
					});
				} catch (cause) {
					importNote = keyUnset(getErrorMessage(cause));
				} finally {
					importing = false;
				}
			}}>{importing ? t('holiday_import.running') : t('holiday_import.google')}</Button
		>
		{#if importNote}
			<span class="text-sm text-destructive" role="alert">{importNote}</span>
		{:else if latestRun?.current?.status === 'failed'}
			<span class="text-sm text-destructive" role="alert"
				>{keyUnset(latestRun.current.error ?? '')}</span
			>
		{:else if latestRun != null}
			<span class="text-sm text-muted-foreground" role="status"
				>{latestRun.current?.progress?.text ?? t('holiday_import.started')}</span
			>
		{/if}
	</Cluster>
{/snippet}

<Cover top={googleImport} gap="sm">
	<CollectionTable
		{client}
		collection="jurisdiction_holidays"
		view="hr_controller:settings:holidays"
		title={t('app.settings.holidays')}
		description={t('holiday_calendar.description')}
		query={{
			where: { jurisdiction_code: { eq: jurisdictionCode }, approval_id: { isNull: true } },
			orderBy: { date: 'desc' }
		}}
		importPipelines={[
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
							buildPayload: holidayImportPayload
						},
						t
					)
			}
		]}
		rowActions={[publishAction]}
	>
		{#snippet columns({ Column })}
			<Column name="date" label={t('component.observed_on')} card="title" />
			<Column name="name" label={t('component.holiday')} card="subtitle" />
			<Column name="original_date" label={t('holiday_calendar.original_date')} />
			<Column name="published_at" label={t('holiday_calendar.published_at')} card="badge" />
			<Column name="consumed_at" label={t('holiday_calendar.consumed_at')} />
		{/snippet}
	</CollectionTable>
</Cover>
