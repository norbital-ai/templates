<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/bolt';
	import { RecordShell } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'meeting_speakers'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const sections = [
		{
			name: 'speaker',
			icon: 'lucide:audio-lines',
			title: t('models.meeting_speakers.singular'),
			fields: ['meeting', 'label', 'name', 'contact']
		}
	];
</script>

{#if view.mode === 'create'}
	<RecordShell
		{ctx}
		of="meeting_speakers"
		mode="create"
		values={view.values}
		fields={['meeting', 'label', 'name', 'contact']}
		{sections}
	/>
{:else}
	<RecordShell
		{ctx}
		of="meeting_speakers"
		id={view.record.id}
		fields={['name', 'contact']}
		{sections}
	/>
{/if}
