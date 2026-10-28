<script lang="ts">
	/** The generated record view; a new one opened from its party (`openCreate`) starts with that party. */
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { createValues } from '../../../lib/ui/create-values.js';
	let { view }: { view: RecordView<'contacts'> } = $props();
	const preset = createValues<'contacts'>();
</script>

<RecordShell
	of="contacts"
	mode={view.mode}
	{...view.mode === 'create' ? { values: { ...preset, ...view.values } } : { id: view.record.id }}
/>
