<script lang="ts">
	/** One report per day, written by the agent; open a row for the full report. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	title="Reports"
	description="One report per day: the book's totals, the market view and one call on every holding."
	icon="lucide:newspaper"
>
	<Table
		{ctx}
		of="report"
		order_by={{ for_date: 'desc' }}
		columns={['for_date', 'headline', 'net_assets', 'day_change', 'market_view']}
		toolbar={{ title: 'Reports', new: false }}
	/>
</AppShell>
