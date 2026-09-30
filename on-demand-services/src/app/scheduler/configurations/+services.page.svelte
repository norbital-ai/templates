<script lang="ts">
	/** What can be booked: the skill each service needs, how long it takes, its price. */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

<AppShell
	icon="lucide:sparkles"
	title={t('app.configurations.services_title')}
	description={t('app.configurations.services_description')}
>
	<Table
		of="services"
		orderBy={{ name: 'asc' }}
		toolbar={{ title: t('app.configurations.tab_services') }}
		columns={['name', 'skill', 'duration_minutes', 'price', 'active']}
	/>
</AppShell>
