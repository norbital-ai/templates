<script lang="ts">
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import RecordEditor, { type Value } from '../../../lib/record-editor.svelte';

	let { view }: { view: CustomFieldView<Value> } = $props();
</script>

<RecordEditor
	value={view.value}
	disabled={view.mode === 'edit' ? view.disabled : true}
	onChange={(next) => view.mode === 'edit' && view.onChange(next)}
	parts={[
		{ key: 'name', label: bolt.t('component.name'), autocomplete: 'name' },
		{ key: 'phone', label: bolt.t('component.phone'), type: 'tel', autocomplete: 'tel' },
		{ key: 'relationship', label: bolt.t('component.relationship'), optional: true }
	]}
/>
