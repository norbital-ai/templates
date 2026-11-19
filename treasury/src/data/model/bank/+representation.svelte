<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'bank'>; ctx: PageContext } = $props();
	const t = ctx.t;

	const sections: readonly RecordSection[] = [
		{
			name: 'bank',
			icon: 'lucide:landmark',
			title: t('app.sections.bank'),
			fields: ['code', 'name', 'offered_products']
		},
		{
			name: 'contacts',
			icon: 'lucide:contact',
			title: t('app.sections.contacts'),
			fields: ['contacts', 'cut_off_time']
		},
		{
			name: 'terms',
			icon: 'lucide:file-check-2',
			title: t('app.sections.terms'),
			fields: ['watch_points', 'letters_of_offer']
		},
		{
			name: 'facilities',
			icon: 'lucide:vault',
			title: t('app.sections.facilities'),
			fields: ['facilities']
		}
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="bank" mode="create" values={view.values} {sections} />
{:else}
	<RecordShell {ctx} of="bank" id={view.record.id} {sections} />
{/if}
