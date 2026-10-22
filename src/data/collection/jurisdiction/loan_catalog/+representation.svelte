<script lang="ts">
	import { bolt } from '$bolt';
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import CatalogSections from '../../../../lib/ui/settings/catalog_sections.svelte';

	let { view }: { view: RecordView<'loan_catalog'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
</script>

<RecordShell
	of="loan_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="loan_catalog"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'loan_catalog');
				if (created) openRecord('loan_catalog', created.id);
			}}
		>
			{#snippet children()}
				<CatalogSections
					sections={[
						{
							name: 'identity',
							title: t('section.identity'),
							fields: ['code', 'name', 'references', 'eligibility']
						},
						{
							name: 'settlement',
							title: t('section.settlement'),
							fields: ['destination', 'direction', 'amount_required', 'bands']
						}
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
