<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'business_partner'>; ctx: PageContext } = $props();
	const t = ctx.t;

	const sections: readonly RecordSection[] = [
		{
			name: 'partner',
			title: t('app.sections.partner'),
			fields: ['name', 'is_supplier', 'is_customer', 'is_active', 'country', 'aliases']
		},
		{
			name: 'terms',
			title: t('app.sections.terms'),
			fields: ['payment_terms', 'products', 'relationship_since', 'eligible_banks']
		},
		{ name: 'notes', title: t('app.sections.notes'), fields: ['notes'], default_open: false }
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="business_partner" mode="create" values={view.values} {sections} />
{:else}
	<RecordShell {ctx} of="business_partner" id={view.record.id} {sections} />
{/if}
