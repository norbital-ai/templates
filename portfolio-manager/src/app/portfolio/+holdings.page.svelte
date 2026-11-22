<script lang="ts">
	/** Every line of the book; open one to set its research direction and read what the agent found. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const settings = ctx.query({
		portfolio_settings: { fields: ['base_currency'], limit: 1 }
	});
	const baseCurrency = $derived(
		settings.current?.portfolio_settings.rows[0]?.base_currency ?? 'USD'
	);
</script>

<AppShell
	title={ctx.t('component.holdings.title')}
	description={ctx.t('component.holdings.description')}
	icon="lucide:trending-up"
>
	<Table
		{ctx}
		of="holding"
		order_by={{ value_base: 'desc' }}
		columns={[
			'instrument',
			'symbol',
			'asset_class',
			'quantity',
			{ field: 'value_base', kind: { kind: 'money', currency: baseCurrency }, align: 'end' },
			{
				field: 'live_value_base',
				kind: { kind: 'money', currency: baseCurrency, optional: true },
				align: 'end'
			},
			'live_change_pct',
			'change_1m_pct',
			'trend',
			'pressure',
			'movement',
			'research_at'
		]}
		toolbar={{
			title: ctx.t('component.holdings.title'),
			new: true,
			actions: [
				{
					icon: 'lucide:sparkles',
					name: ctx.t('component.holdings.run_agent'),
					description: ctx.t('component.holdings.run_agent_description'),
					run: () => ctx.run('portfolio_agent', {})
				}
			]
		}}
	/>
</AppShell>
