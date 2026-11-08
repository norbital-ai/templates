<script lang="ts">
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	let { view }: { view: RecordView<'order_files'> } = $props();
</script>

<RecordForm
	{view}
	readonly={view.mode !== 'create'}
	sections={[
		{
			name: 'file',
			fields: ['title', 'file'],
			wide: ['file']
		}
	]}
/>
