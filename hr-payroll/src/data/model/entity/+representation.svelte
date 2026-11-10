<script lang="ts">
	import { bolt } from '$bolt';
	import {
		Button,
		EmptyState,
		Field,
		Form,
		Icon,
		openRecord,
		RecordShell,
		Sheet,
		Table,
		Tabs
	} from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import VersionTimeline from '../../../lib/ui/components/version_timeline.svelte';
	import { formatTermsDates } from '../../../lib/ui/format/display_formatters.js';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'entity'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t = bolt.t;
	let scheduling = $state(false);
	const versions = $derived(
		record == null
			? null
			: bolt.query({
					entity_profile_version: {
						where: { entity_id: { eq: record.id } },
						fields: ['name', 'effective_range', 'status'],
						limit: 10000
					}
				})
	);
	const statusText = (status: string): string =>
		t(
			status === 'DRAFT'
				? 'contract.open'
				: status === 'VOID'
					? 'contract.voided'
					: 'contract.sealed'
		);
	const timeline = $derived(
		(versions?.current?.entity_profile_version.rows ?? [])
			.toSorted((left, right) =>
				String(right.effective_range.from).localeCompare(String(left.effective_range.from))
			)
			.map((row) => ({
				id: row.id,
				period: formatTermsDates(row, t),
				status: statusText(row.status),
				state: row.status,
				detail: row.name
			}))
	);
</script>

{#snippet general()}
	<Form
		of="entity"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		onOutcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const created = outcome.records.find((row) => row.model === 'entity');
			if (created) openRecord('entity', created.id);
		}}
	>
		{#snippet children()}<Stack gap="md"
				>{#each ['code', 'name', 'settings_code', 'epf_registered_on', 'socso_registered_on'] as name (name)}<Field
						{name}
					/>{/each}</Stack
			>{/snippet}
	</Form>
{/snippet}

{#snippet versionsOnly()}
	{#if record}
		<Stack gap="sm">
			<Cluster justify="between">
				<h3 class="text-heading">{t('employer_version.plural')}</h3>
				<Button
					size="icon"
					variant="outline"
					aria-label={t('employer_version.new')}
					title={t('employer_version.new')}
					onclick={() => openRecord('entity_profile_version', 'new')}
					><Icon name="lucide:plus" class="size-4" /></Button
				>
			</Cluster>
			{#if versions?.loading}
				<p class="text-meta">{t('component.loading')}</p>
			{:else if timeline.length === 0}
				<EmptyState title={t('employer_version.empty')} />
			{:else}
				<VersionTimeline
					label={t('employer_version.plural')}
					items={timeline}
					onOpen={(id) => openRecord('entity_profile_version', id)}
				/>
			{/if}
		</Stack>
	{/if}
{/snippet}

{#snippet changesOnly()}
	{#if record}
		<Table
			of="entity_change"
			key="entity-scheduled-changes"
			where={{ entity_id: { eq: record.id }, applied_version_id: { isNull: true } }}
			toolbar={{
				title: t('section.scheduled_changes'),
				new: () => (scheduling = true)
			}}
			columns={['effective_from', 'field_path', 'new_value', 'notes']}
		/>
	{/if}
{/snippet}

{#snippet versionsTab()}
	{#if record}
		<Tabs
			tabs={[
				{
					name: 'versions',
					title: t('employer_version.plural'),
					icon: 'lucide:history',
					body: versionsOnly
				},
				{
					name: 'changes',
					title: t('section.scheduled_changes'),
					icon: 'lucide:calendar-clock',
					body: changesOnly
				}
			]}
		/>
	{/if}
{/snippet}

{#snippet holidaysTab()}
	{#if record}
		<Table
			of="holiday"
			key="entity-holidays"
			where={{ entity_id: { eq: record.id } }}
			orderBy={{ date: 'asc' }}
			toolbar={{ title: t('app.settings.holidays'), new: true }}
			columns={[
				'date',
				'name',
				'employee_id',
				{ field: 'published_at', label: t('calendar.published') }
			]}
		/>
	{/if}
{/snippet}

{#snippet payGroupsTab()}
	{#if record}
		<Table
			of="pay_group"
			key="entity-pay-groups"
			where={{ entity_id: { eq: record.id } }}
			orderBy={{ name: 'asc' }}
			toolbar={{ title: t('entity.tab_pay_groups'), new: true }}
			columns={['name', 'payment_schedule']}
		/>
	{/if}
{/snippet}

<RecordShell
	of="entity"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}
		{@render general()}
	{:else}
		<Tabs
			tabs={[
				{ name: 'general', title: t('person.tab_general'), body: general },
				{ name: 'versions', title: t('employer_version.plural'), body: versionsTab },
				{ name: 'pay_groups', title: t('entity.tab_pay_groups'), body: payGroupsTab },
				{ name: 'holidays', title: t('entity.tab_holidays'), body: holidaysTab }
			]}
		/>
	{/if}
</RecordShell>

{#if record !== null}
	<Sheet bind:open={scheduling} title={t('entity.schedule_change')}>
		<Form
			of="entity_change"
			mode="create"
			values={{ entity_id: record.id }}
			onOutcome={(outcome) => {
				if (outcome.kind === 'committed') scheduling = false;
			}}
		>
			{#snippet children()}<Stack gap="md"
					>{#each ['field_path', 'new_value', 'effective_from', 'notes'] as name (name)}<Field
							{name}
						/>{/each}</Stack
				>{/snippet}
		</Form>
	</Sheet>
{/if}
