<script lang="ts">
	import { bolt } from '$bolt';
	import {
		Form,
		openRecord,
		RecordShell,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import CatalogSections from '../../../../lib/ui/settings/catalog_sections.svelte';
	import EntitlementEditor from '../../../../lib/ui/settings/entitlement_editor.svelte';

	let { view }: { view: RecordView<'leave_catalog'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
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
			mode={view.mode === 'create' ? 'create' : 'update'}
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
				{#snippet entitlement(field: FieldEditor)}
					<EntitlementEditor
						value={field.value}
						onChange={field.onChange}
						id={field.id}
						disabled={field.disabled}
					/>
				{/snippet}
				<CatalogSections
					editors={{ entitlement }}
					sections={[
						{
							name: 'identity',
							title: t('section.identity'),
							fields: ['code', 'name', 'description', 'authority']
						},
						{ name: 'entitlement', title: t('section.entitlement'), fields: ['entitlement'] },
						{
							name: 'rules',
							title: t('section.rules'),
							fields: ['unit', 'consumes_code', 'eligibility', 'pay_fraction', 'share_by', 'is_npl']
						},
						{
							name: 'cash',
							title: t('section.cash'),
							defaultOpen: false,
							fields: ['can_encash', 'encash_on_exit', 'encash_at_window_end']
						}
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
