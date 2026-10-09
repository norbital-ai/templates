<script lang="ts">
	import { bolt } from '$bolt';
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import CatalogSections from '../../../../lib/ui/settings/catalog_sections.svelte';

	let { view }: { view: RecordView<'leave_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
</script>

<RecordShell
	of="leave_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="leave_catalog"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'leave_catalog');
				if (created) openRecord('leave_catalog', created.id);
			}}
		>
			{#snippet children()}
				<CatalogSections
					sections={[
						{
							name: 'identity',
							title: t('section.identity'),
							fields: ['code', 'name', 'description']
						},
						{ name: 'entitlement', title: t('section.entitlement'), fields: ['entitlement'] },
						{
							name: 'rules',
							title: t('section.rules'),
							fields: ['unit', 'consumes_code', 'eligibility', 'pay_fraction']
						},
						{
							name: 'cash',
							title: t('section.cash'),
							fields: ['can_encash', 'encash_on_exit', 'encash_at_window_end', 'is_npl']
						},
						{ name: 'authority', title: t('section.authority'), fields: ['authority'] }
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
