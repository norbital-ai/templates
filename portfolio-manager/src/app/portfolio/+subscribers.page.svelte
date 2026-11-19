<script lang="ts">
	/** Who gets the daily report, and the envoy accounts it goes out on. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();

	const envoys = ctx.query({
		sys_integration: {
			where: { envoy: { is_null: false }, active: { eq: true } },
			fields: ['name', 'integration'],
			limit: 20
		}
	});
	const accounts = $derived(envoys.current?.sys_integration.rows ?? []);
</script>

<AppShell
	title="Subscribers"
	description="Each morning, once the report is filed, the envoy sends it with its PDF to every subscriber at their own WhatsApp, Telegram, Slack or Discord. Clients subscribe themselves from Reports."
	icon="lucide:bell"
>
	<Stack size="fill" gap="md">
		{#if envoys.current !== undefined}
			<p class="text-meta">
				{accounts.length === 0
					? 'No envoy is deployed: subscribers get the report in their inbox only. Deploy one on a chat account under Settings → Integrations → Envoys.'
					: `Sent through ${accounts.map((one) => `${one.name} (${one.integration})`).join(', ')}.`}
			</p>
		{/if}
		<Table
			{ctx}
			of="report_subscription"
			columns={['user']}
			toolbar={{ title: 'Subscribers', new: true }}
		/>
	</Stack>
</AppShell>
