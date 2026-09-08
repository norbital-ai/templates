<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Cluster, Cover, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui/tabs';
	import { todayKey } from './calendar.js';

	let { jurisdictionCode }: { jurisdictionCode: string } = $props();
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
	<CollectionTable
		{client}
		collection="jurisdiction_holiday_sources"
		view="hr_controller:settings:holiday_sources"
		title={t('holiday_source.title')}
		description={t('holiday_source.description')}
		query={{
			where: { jurisdiction_code: { eq: jurisdictionCode }, approval_id: { isNull: true } }
		}}
	>
		{#snippet columns({ Column })}
			<Column name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} card="title" />
			<Column name="calendar_id" label={t('holiday_source.calendar_id')} />
			<Column name="time_zone" label={t('holiday_source.time_zone')} />
			<Column name="enabled" label={t('holiday_source.enabled')} />
		{/snippet}
	</CollectionTable>
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
