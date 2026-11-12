<script lang="ts">
	/** The one settings row: base currency, the account the report is sent from and its recipients. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	title="Settings"
	description="The currency the book is valued in, and who receives the daily report through which paired account. Keep one row."
	icon="lucide:settings"
>
	<Table
		{ctx}
		of="portfolio_settings"
		columns={['base_currency', 'report_via', 'recipients']}
		toolbar={{ title: 'Settings', new: true }}
	/>
</AppShell>
