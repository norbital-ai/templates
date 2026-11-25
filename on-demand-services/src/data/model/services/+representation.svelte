<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'services'>; ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);

	const sections = $derived<RecordSection[]>([
		{
			name: 'service',
			icon: 'lucide:briefcase',
			title: t('models.services.singular'),
			fields: ['name', 'category', 'skill', 'active', 'description']
		},
		{
			name: 'pricing',
			icon: 'lucide:clock',
			title: t('section.pricing_duration'),
			fields: ['duration_minutes', 'price']
		}
	]);
</script>

{#if record === null}
	<RecordShell
		{ctx}
		of="services"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell {ctx} of="services" id={record.id} title={record.name} {sections} />
{/if}
