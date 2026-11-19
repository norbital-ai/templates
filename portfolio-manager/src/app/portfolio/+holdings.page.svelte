<script lang="ts">
	/** Every line of the book; open one to set its research direction and read what the agent found. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
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
			'currency',
			'quantity',
			'value_base',
			'live_value_base',
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
