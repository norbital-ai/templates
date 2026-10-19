<script lang="ts">
	import { Textarea, type FieldEditor } from '@norbital-ai/ui';
	let {
		field
	}: {
		field: FieldEditor;
	} = $props();
</script>

<Textarea
	id={field.id}
	value={typeof field.value === 'string' ? field.value : ''}
	rows={10}
	disabled={field.disabled}
	aria-invalid={Boolean(field.error)}
	oninput={(event) => field.onChange(event.currentTarget.value)}
/>
