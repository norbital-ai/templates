<script lang="ts">
	import { Field, Form, RecordShell, type FieldEditor, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import ReversalEditor from '../../../../../../../lib/ui/person/reversal_editor.svelte';
	import ReversalCancel from '../../../../../../../lib/ui/person/reversal_cancel.svelte';
	let { view }: { view: RecordView<'adhoc_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	// a reversal no run has paid is cancelled by the ordinary delete
	const canCancel = $derived(
		record !== null &&
			record.reverses != null &&
			record.payroll_run_id == null &&
			view.mode !== 'create' &&
			view.capabilities?.delete.allowed === true
	);
</script>

{#snippet reversal(field: FieldEditor)}<ReversalEditor
		employment={field.form.get('employment_id')}
		catalog={field.form.get('catalog_id')}
		value={field.value}
		onChange={field.onChange}
		id={field.id}
		disabled={field.disabled}
	/>{/snippet}

{#snippet cancelAction()}{#if record !== null}<ReversalCancel
			of="adhoc_catalog_entry"
			id={record.id}
		/>{/if}{/snippet}

<RecordShell
	of="adhoc_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	footerActions={canCancel ? cancelAction : undefined}
>
	<Form
		of="adhoc_catalog_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Stack gap="md">
				{#each record === null ? ['employment_id', 'catalog_id', 'description', 'quantity', 'unit', 'incurred_on', 'evidence_file'] : ['description', 'quantity', 'unit', 'incurred_on', 'evidence_file'] as name (name)}<Field
						{name}
					/>{/each}
				{#if record === null}<Field name="reverses" editor={reversal} />{/if}
			</Stack>{/snippet}
	</Form>
</RecordShell>
