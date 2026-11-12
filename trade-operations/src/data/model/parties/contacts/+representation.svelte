<script lang="ts">
	/** The generated record view; a new one opened from its party (`openCreate`) starts with that party. */
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { createValues } from '../../../../lib/ui/create-values.js';
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { view, ctx }: { view: RecordView<'contacts'>; ctx: PageContext } = $props();
	const preset = createValues<'contacts'>();
</script>

<RecordShell
	{ctx}
	of="contacts"
	mode={view.mode}
	{...view.mode === 'create' ? { values: { ...preset, ...view.values } } : { id: view.record.id }}
/>
