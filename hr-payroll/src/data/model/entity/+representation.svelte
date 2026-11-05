<script lang="ts">
	import { bolt } from '$bolt';
	import {
		Button,
		EmptyState,
		Field,
		Form,
		openRecord,
		RecordShell,
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
	const versions = $derived(
		record == null
			? null
			: bolt.query({
					entity_profile_version: {
						where: { entity_id: { eq: record.id } },
						fields: ['name', 'effective_range', 'status', 'registrations', 'statutory_units'],
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
	const registrationsOf = (row: {
		readonly registrations?:
			| readonly {
					readonly scheme_code: string;
					readonly number: string;
			  }[]
			| null;
		readonly statutory_units?:
			| readonly {
					readonly registrations?:
						| readonly {
								readonly scheme_code: string;
								readonly number: string;
						  }[]
						| null;
			  }[]
			| null;
	}): string[] => {
		const units = row.statutory_units ?? [];
		return [
			...(row.registrations ?? []),
			...units.flatMap((unit) => unit.registrations ?? [])
		].flatMap((registration) => {
			const number = String(registration.number ?? '').trim();
			return number === ''
				? []
				: [`${String(registration.scheme_code ?? '').trim()} ${number}`.trim()];
		});
	};
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
				detail: [row.name, ...registrationsOf(row)].filter((part) => part !== '').join(' · ')
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
				>{#each ['code', 'name', 'settings_code', 'source_reference'] as name (name)}<Field
						{name}
					/>{/each}</Stack
			>{/snippet}
	</Form>
{/snippet}

{#snippet versionsTab()}
	{#if record}
		<Stack gap="sm">
			<Cluster justify="end">
				<Button variant="outline" onclick={() => openRecord('entity_profile_version', 'new')}
					>{t('employer_version.new')}</Button
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

{#snippet holidaysTab()}
	{#if record}
		<Table
			of="holiday"
			key="entity-holidays"
			where={{ entity_id: { eq: record.id } }}
			orderBy={{ date: 'asc' }}
			toolbar={{ title: t('app.settings.holidays'), new: true }}
			columns={['date', 'name', { field: 'published_at', label: t('calendar.published') }]}
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
				{ name: 'holidays', title: t('entity.tab_holidays'), body: holidaysTab }
			]}
		/>
	{/if}
</RecordShell>
