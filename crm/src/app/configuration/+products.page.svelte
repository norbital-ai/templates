<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	let offeringOpen = $state(false);
	const settings = $derived(offeringOpen ? ctx.query({ offering_settings: { limit: 1 } }) : null);
	const seller = $derived(settings?.current?.offering_settings.rows[0] ?? null);
</script>

<AppShell
	icon="lucide:package"
	title={t('products.title')}
	description={t('products.description')}
	variant="full"
>
	<Table
		{ctx}
		of="products"
		toolbar={{
			title: false,
			actions: [
				{
					name: t('products.offering_settings'),
					icon: 'lucide:sparkles',
					run: () => {
						offeringOpen = true;
					}
				}
			]
		}}
		order_by={{ category: 'asc' }}
		columns={['name', 'category', 'active', 'summary']}
	/>
</AppShell>

<Sheet
	open={offeringOpen}
	on_open_change={(open) => (offeringOpen = open)}
	title={t('products.offering_settings')}
>
	{#if settings?.error}<EmptyState title={settings.error.message} />
	{:else if settings?.current !== undefined}{#key seller?.id ?? 'new'}<RecordShell
				{ctx}
				of="offering_settings"
				{...seller === null ? { mode: 'create' as const } : { id: seller.id }}
				fields={['seller_name', 'offering_summary', 'research_focus']}
				on_done={() => (offeringOpen = false)}
			/>{/key}{/if}
</Sheet>
