<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	/** What can be booked: the skill each service needs, how long it takes, its price. */
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:sparkles"
	title={t('app.configurations.services_title')}
	description={t('app.configurations.services_description')}
>
	<Table
		{ctx}
		of="services"
		order_by={{ name: 'asc' }}
		toolbar={{ title: t('app.configurations.tab_services') }}
		columns={['name', 'skill', 'duration_minutes', 'price', 'active']}
	/>
</AppShell>
