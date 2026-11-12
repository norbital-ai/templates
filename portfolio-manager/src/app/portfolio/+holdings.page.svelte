<script lang="ts">
	/** Every line of the book; open one to set its research direction and read what the agent found. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	title="Holdings"
	description="Every line of the book as the statement recorded it. The calculated columns come from the market at the agent's last run. Cash is a line of its own; a facility is a loan line with a negative value."
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
			'movement',
			'research_at'
		]}
		toolbar={{
			title: 'Holdings',
			new: true,
			actions: [
				{
					icon: 'lucide:sparkles',
					name: 'Run the agent now',
					description: 'Price the book, research the largest lines and write today’s report.',
					run: () => ctx.run('portfolio_agent', {})
				}
			]
		}}
	/>
</AppShell>
