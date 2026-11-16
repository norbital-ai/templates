<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'bank'>; ctx: PageContext } = $props();
	const t = ctx.t;

	const sections: readonly RecordSection[] = [
		{
			name: 'bank',
			title: t('app.sections.bank'),
			fields: ['code', 'name', 'is_active', 'offered_products']
		},
		{
			name: 'contacts',
			title: t('app.sections.contacts'),
			fields: ['contacts', 'cut_off_time', 'settlement_instructions']
		},
		{
			name: 'terms',
			title: t('app.sections.terms'),
			fields: ['terms_notes', 'watch_points', 'letters_of_offer']
		},
		{ name: 'facilities', title: t('app.sections.facilities'), fields: ['facilities'] }
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="bank" mode="create" values={view.values} {sections} />
{:else}
	<RecordShell {ctx} of="bank" id={view.record.id} {sections} />
{/if}
