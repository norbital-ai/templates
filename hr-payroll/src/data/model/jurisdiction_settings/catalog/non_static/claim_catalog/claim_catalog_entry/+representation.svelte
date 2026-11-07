<script lang="ts">
	import { Field, Form, RecordShell, type FieldEditor, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import ReversalEditor from '../../../../../../../lib/ui/person/reversal_editor.svelte';
	let { view }: { view: RecordView<'claim_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#snippet reversal(field: FieldEditor)}<ReversalEditor
		family="claim"
		employment={field.form.get('employment_id')}
		catalog={field.form.get('catalog_id')}
		value={field.value}
		onChange={field.onChange}
		id={field.id}
		disabled={field.disabled}
	/>{/snippet}

<RecordShell
	of="claim_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="claim_catalog_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Stack gap="md">
				{#each record === null ? ['employment_id', 'catalog_id', 'quantity', 'incurred_on', 'evidence_file'] : ['quantity', 'incurred_on', 'evidence_file'] as name (name)}<Field
						{name}
					/>{/each}
				{#if record === null}<Field name="reverses" editor={reversal} />{/if}
			</Stack>{/snippet}
	</Form>
</RecordShell>
