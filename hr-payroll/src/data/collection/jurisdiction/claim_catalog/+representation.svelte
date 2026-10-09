<script lang="ts">
	import { bolt } from '$bolt';
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import CatalogSections from '../../../../lib/ui/settings/catalog_sections.svelte';

	let { view }: { view: RecordView<'claim_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
</script>

<RecordShell
	of="claim_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="claim_catalog"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'claim_catalog');
				if (created) openRecord('claim_catalog', created.id);
			}}
		>
			{#snippet children()}
				<CatalogSections
					sections={[
						{ name: 'identity', title: t('section.identity'), fields: ['code', 'name'] },
						{ name: 'authority', title: t('section.authority'), fields: ['authority'] },
						{
							name: 'rules',
							title: t('section.rules'),
							fields: ['eligibility', 'qualifies_when']
						},
						{
							name: 'settlement',
							title: t('section.settlement'),
							fields: ['destination', 'direction', 'bands', 'counts_toward']
						}
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
