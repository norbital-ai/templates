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
		{ key: 'line_1', label: bolt.t('component.address_line_1') },
		{ key: 'line_2', label: bolt.t('component.address_line_2'), optional: true },
		{ key: 'city', label: bolt.t('component.city') },
		{ key: 'state', label: bolt.t('component.state'), optional: true },
		{ key: 'postal_code', label: bolt.t('component.postal_code') },
		{ key: 'country', label: bolt.t('component.country') }
	]}
/>
