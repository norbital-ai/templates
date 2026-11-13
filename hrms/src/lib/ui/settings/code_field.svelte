<script lang="ts">
	import type { UiContext } from '@norbital-ai/ui';
	import { CodeEditor, Field, type FieldEditor } from '@norbital-ai/ui';

	let { ctx, name, help }: { ctx: UiContext; name: string; help?: string } = $props();
</script>

{#snippet editor(field: FieldEditor)}
	<CodeEditor
		language="javascript"
		wrap
		value={String(field.value ?? '')}
		aria-label={field.name}
		on_change={field.on_change}
	/>
{/snippet}

{#snippet view(field: Pick<FieldEditor, 'value' | 'name'>)}
	<CodeEditor
		language="javascript"
		wrap
		readonly
		min_height="3rem"
		value={String(field.value ?? '')}
		aria-label={field.name}
	/>
{/snippet}

<Field {ctx} {name} {...help === undefined ? {} : { help }} {editor} {view} />
