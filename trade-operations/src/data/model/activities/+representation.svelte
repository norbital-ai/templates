<script lang="ts">
	/** The generated record view; a new one opened from its order (`openCreate`) starts with that order. */
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { createValues } from '../../../lib/ui/create-values.js';
	let { view }: { view: RecordView<'activities'> } = $props();
	const preset = createValues<'activities'>();
</script>

<RecordShell
	of="activities"
	mode={view.mode}
	{...view.mode === 'create' ? { values: { ...preset, ...view.values } } : { id: view.record.id }}
/>
