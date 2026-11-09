<script lang="ts">
	/** A settings version's arbitrary lookup tables, separate from its declared form fields. */
	import { bolt } from '$bolt';
	import { Field, Form, type FieldEditor, type RecordView } from '@norbital-ai/ui';
	import LookupSections from './lookup_sections.svelte';

	let { view }: { view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#snippet lookupView({ value, name }: Pick<FieldEditor, 'value' | 'name'>)}
	<LookupSections {value} {name} />
{/snippet}
{#snippet lookupEditor({ value, name, disabled, onChange }: FieldEditor)}
	<LookupSections {value} {name} {disabled} {onChange} />
{/snippet}

{#if record}<Form of="jurisdiction_settings" mode="update" id={record.id} {record}>
		{#snippet children()}
			<Field
				name="lookup"
				label={bolt.t('settings_form.lookup')}
				view={lookupView}
				editor={lookupEditor}
			/>
		{/snippet}
	</Form>{/if}
