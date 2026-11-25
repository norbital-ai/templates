<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
</script>

<AppShell
	icon="lucide:briefcase"
	title={t('app.configuration.services_title')}
	description={t('app.configuration.services_description')}
>
	<Table
		{ctx}
		of="services"
		order_by={{ name: 'asc' }}
		toolbar={{ title: t('app.configuration.tab_services') }}
		columns={['name', 'category', 'skill', 'duration_minutes', 'price', 'active']}
	/>
</AppShell>
