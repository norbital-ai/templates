<script lang="ts">
	import { bolt } from '$bolt';
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import CatalogSections from '../../../lib/ui/settings/catalog_sections.svelte';

	let { view }: { view: RecordView<'suspension_catalog'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
</script>

<RecordShell
	of="suspension_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="suspension_catalog"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.model === 'suspension_catalog');
				if (created) openRecord('suspension_catalog', created.id);
			}}
		>
			{#snippet children()}
				<CatalogSections
					sections={[
						{
							name: 'identity',
							title: t('section.identity'),
							fields: ['code', 'name', 'references']
						},
						{
							name: 'rules',
							title: t('section.rules'),
							fields: ['counts_as_attended', 'scheduled', 'eligibility', 'quantity', 'rate']
						},
						{ name: 'pay', title: t('section.pay_lines'), fields: ['pay'] }
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
