<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'products'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const fields = ['name', 'category', 'active', 'summary', 'fit_criteria'] as const;
	const sections: RecordSection[] = [
		{
			name: 'product',
			icon: 'lucide:package',
			title: t('models.products.singular'),
			fields: ['name', 'category', 'active', 'summary']
		},
		{
			name: 'qualification',
			icon: 'lucide:target',
			title: t('products.fit_section'),
			hint: t('products.fit_hint'),
			fields: ['fit_criteria']
		}
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="products" mode="create" values={view.values} {fields} {sections} />
{:else}
	<RecordShell {ctx} of="products" id={view.record.id} {fields} {sections} />
{/if}
