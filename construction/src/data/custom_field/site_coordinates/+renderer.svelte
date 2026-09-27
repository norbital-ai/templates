<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/ui';
	import RecordEditor, { type Value } from '../../../lib/record-editor.svelte';

	let { view }: { view: CustomFieldView<Value> } = $props();
</script>

<RecordEditor
	value={view.value}
	disabled={view.mode === 'edit' ? view.disabled : true}
	onChange={(next) => view.mode === 'edit' && view.onChange(next)}
	parts={['x', 'y', 'z'].map((key) => ({
		key,
		label: key.toUpperCase(),
		type: 'number' as const,
		optional: true as const
	}))}
/>
