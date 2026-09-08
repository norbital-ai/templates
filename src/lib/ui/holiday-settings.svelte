<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Effect } from 'effect';
	import { toast } from 'svelte-sonner';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import HolidaySourceRenderer from '../../datatypes/holiday_source/+renderer.svelte';
	import { Bound, Cluster, Cover, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui/tabs';
	import { todayKey } from './calendar.js';

	import type { WorkspaceRow } from '$bolt/types.js';

	let { version }: { version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const jurisdictionCode = $derived(version.jurisdiction_code);
	/**
	 * One-column write, like the seal and the void: a whole-row form would carry `sealed_at` and
	 * be routed to approval, while the source is operational configuration set under a seal.
	 */
	let sourceDraft = $state<WorkspaceRow<'jurisdiction_settings'>['holiday_source']>(null);
	let sourceError = $state<string | null>(null);
	$effect(() => {
		sourceDraft = version.holiday_source;
	});
	const { t } = useI18n<TenantI18nKeys>();
	let year = $state(Number(todayKey().slice(0, 4)) + 1);
	let error = $state<string | null>(null);
	const latest = $derived(client.automations.holiday_import.latest);
</script>

{#snippet importControls()}
	<Stack gap="sm">
		<p class="text-sm text-muted-foreground">{t('holiday_import.description')}</p>
		<Cluster>
			<label class="text-sm">
				<Stack gap="xs">
					{t('holiday_calendar.year')}
					<Input
						type="number"
						min="1"
						max="9998"
						value={year}
						oninput={(event) => {
							year = Number(event.currentTarget.value);
						}}
					/>
				</Stack>
			</label>
			<Button
				disabled={client.automations.holiday_import.pending > 0 ||
					!Number.isInteger(year) ||
					year < 1 ||
					year > 9998}
				onclick={async () => {
					error = null;
					try {
						await client.automations.holiday_import.run({
							jurisdiction_code: jurisdictionCode,
							year
						});
					} catch (cause) {
						error = getErrorMessage(cause);
					}
				}}
				>{client.automations.holiday_import.pending > 0
					? t('holiday_import.running')
					: t('holiday_import.run')}</Button
			>
		</Cluster>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		{#if latest?.current?.status === 'failed'}
			<p class="text-sm text-destructive" role="alert">{latest.current.error}</p>
		{:else if latest != null}
			<p class="text-sm text-muted-foreground" role="status">
				{latest.current?.progress?.text ?? t('holiday_import.started')}
			</p>
		{/if}
	</Stack>
{/snippet}

{#snippet calendars()}
	<Cover top={importControls}>
		<Bound size="full">
			<CollectionTable
				{client}
				collection="jurisdiction_holiday_calendars"
				view="hr_controller:settings:holiday_calendars"
				title={t('holiday_calendar.title')}
				description={t('holiday_calendar.complete_list_hint')}
				query={{
					where: { jurisdiction_code: { eq: jurisdictionCode }, approval_id: { isNull: true } },
					orderBy: { year: 'desc', revision: 'desc' }
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="jurisdiction_code"
						label={t('holiday_calendar.jurisdiction')}
						card="title"
					/>
					<Column name="year" label={t('holiday_calendar.year')} />
					<Column name="revision" label={t('holiday_calendar.revision')} />
					<Column name="published_at" label={t('holiday_calendar.published_at')} />
					<Column name="observations" label={t('holiday_calendar.observations')} />
					<Column name="import_review" label={t('holiday_import.pending')} />
				{/snippet}
			</CollectionTable>
		</Bound>
	</Cover>
{/snippet}

{#snippet sources()}
	<form
		class="flex flex-col gap-3"
		onsubmit={(event) => {
			event.preventDefault();
			sourceError = null;
			Effect.runFork(
				submitCollectionMutation(() =>
					client.db.jurisdiction_settings.mutate([{ id: version.id, holiday_source: sourceDraft }])
				).pipe(
					Effect.tap(() => Effect.sync(() => toast.success(t('holiday_source.saved')))),
					Effect.catch((cause) =>
						Effect.sync(() => {
							sourceError = getErrorMessage(cause);
						})
					)
				)
			);
		}}
	>
		<div data-collection-field="holiday_source" class="flex flex-col gap-2">
			<label class="text-sm font-semibold" for="holiday-source-calendar"
				>{t('holiday_source.title')}</label
			>
			<HolidaySourceRenderer
				mode="edit"
				field={{ name: 'holiday_source', type: 'custom' }}
				value={sourceDraft}
				disabled={false}
				onValueChange={(value) => {
					sourceDraft = value;
				}}
			/>
		</div>
		{#if sourceError}<p class="text-sm text-destructive" role="alert">{sourceError}</p>{/if}
		<Cluster><Button type="submit" size="sm">{t('holiday_source.save')}</Button></Cluster>
	</form>
{/snippet}

<Tabs
	config={[
		{
			name: 'calendars',
			label: t('holiday_import.calendars'),
			icon: 'lucide:calendar-days',
			content: calendars
		},
		{
			name: 'sources',
			label: t('holiday_import.sources'),
			icon: 'lucide:calendar-sync',
			content: sources
		}
	]}
/>
