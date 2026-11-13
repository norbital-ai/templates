<script lang="ts">
	/** The one settings row (base currency, benchmarks, the account and chats the report goes to) and its subscribers. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	title="Settings"
	description="The currency the book is valued in, the benchmarks, the paired account and chats the daily report goes to, and the users subscribed to it. Keep one settings row."
	icon="lucide:settings"
>
	<Stack size="fill" gap="lg">
		<Table
			{ctx}
			of="portfolio_settings"
			columns={['base_currency', 'report_via', 'recipients', 'benchmarks']}
			toolbar={{ title: 'Settings', new: true }}
		/>
		<Table
			{ctx}
			of="report_subscription"
			columns={['user']}
			toolbar={{ title: 'Subscribers', new: true }}
		/>
	</Stack>
</AppShell>
