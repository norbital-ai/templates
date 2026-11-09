<script lang="ts">
	import { CodeEditor, Field, type FieldEditor } from '@norbital-ai/ui';

	let { name, help }: { name: string; help?: string } = $props();
</script>

{#snippet editor(field: FieldEditor)}
	<CodeEditor
		language="javascript"
		wrap
		value={String(field.value ?? '')}
		aria-label={field.name}
		onChange={field.onChange}
	/>
{/snippet}

{#snippet view(field: Pick<FieldEditor, 'value' | 'name'>)}
	<CodeEditor
		language="javascript"
		wrap
		readonly
		minHeight="3rem"
		value={String(field.value ?? '')}
		aria-label={field.name}
	/>
{/snippet}

<Field {name} {help} {editor} {view} />
