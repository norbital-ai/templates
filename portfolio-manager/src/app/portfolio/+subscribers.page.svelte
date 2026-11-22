<script lang="ts">
	/** Who gets the daily report, and the envoy accounts it goes out on. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell, Cover } from '@norbital-ai/ui/layout';
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

{#snippet envoyStatus()}
	<p class="text-meta">
		{accounts.length === 0
			? ctx.t('component.subscribers.no_envoy')
			: ctx.t('component.subscribers.sent_through', {
					accounts: accounts.map((one) => `${one.name} (${one.integration})`).join(', ')
				})}
	</p>
{/snippet}

<AppShell
	title={ctx.t('component.subscribers.title')}
	description={ctx.t('component.subscribers.description')}
	icon="lucide:bell"
>
	<Cover size="fill" gap="md" {...envoys.current !== undefined ? { top: envoyStatus } : {}}>
		<Table
			{ctx}
			of="report_subscription"
			columns={['user']}
			toolbar={{ title: ctx.t('component.subscribers.title'), new: true }}
		/>
	</Cover>
</AppShell>
