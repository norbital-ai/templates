<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'business_partner'>; ctx: PageContext } = $props();
	const t = ctx.t;

	const sections: readonly RecordSection[] = [
		{
			name: 'partner',
			icon: 'lucide:contact-round',
			title: t('app.sections.partner'),
			fields: ['name', 'role', 'country', 'aliases']
		},
		{
			name: 'terms',
			icon: 'lucide:file-check-2',
			title: t('app.sections.terms'),
			fields: ['payment_terms', 'products', 'eligible_banks']
		},
		{
			name: 'notes',
			icon: 'lucide:notebook-pen',
			title: t('app.sections.notes'),
			fields: ['notes'],
			default_open: false
		}
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="business_partner" mode="create" values={view.values} {sections} />
{:else}
	<RecordShell {ctx} of="business_partner" id={view.record.id} {sections} />
{/if}
