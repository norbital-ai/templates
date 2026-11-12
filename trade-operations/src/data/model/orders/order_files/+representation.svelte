<script lang="ts">
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { view, ctx }: { view: RecordView<'order_files'>; ctx: PageContext } = $props();
</script>

<RecordForm
	{ctx}
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
