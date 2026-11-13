<script lang="ts">
	/** A settings version's arbitrary lookup tables, separate from its declared form fields. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, type FieldEditor, type RecordView } from '@norbital-ai/ui';
	import LookupSections from './lookup_sections.svelte';

	let { ctx, view }: { ctx: PageContext; view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#snippet lookupView({ value, name }: Pick<FieldEditor, 'value' | 'name'>)}
	<LookupSections {ctx} {value} {name} />
{/snippet}
{#snippet lookupEditor({ value, name, disabled, on_change }: FieldEditor)}
	<LookupSections {ctx} {value} {name} {disabled} {on_change} />
{/snippet}

{#if record}<Form {ctx} of="jurisdiction_settings" mode="update" id={record.id} {record}>
		{#snippet children()}
			<Field
				{ctx}
				name="lookup"
				label={ctx.t('settings_form.lookup')}
				view={lookupView}
				editor={lookupEditor}
			/>
		{/snippet}
	</Form>{/if}
