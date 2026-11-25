<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'provider_time_off'>; ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const scopedProvider = $derived(
		record !== null || (view.mode === 'create' && view.values.provider != null)
	);

	const fields = $derived(
		scopedProvider ? (['period', 'reason'] as const) : (['provider', 'period', 'reason'] as const)
	);

	const sections = $derived<RecordSection[]>([
		{
			name: 'time_off',
			icon: 'lucide:calendar-off',
			title: t('models.provider_time_off.singular'),
			fields: [...fields]
		}
	]);
</script>

{#if record === null}
	<RecordShell
		{ctx}
		of="provider_time_off"
		fields={[...fields]}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell {ctx} of="provider_time_off" fields={[...fields]} id={record.id} {sections} />
{/if}
