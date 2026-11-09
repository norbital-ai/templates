<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
</script>

<AppShell
	title={bolt.t('app.work_events.title')}
	description={bolt.t('app.work_events.description')}
	icon="lucide:cloud-sun"
>
	<Table
		of="work_event"
		key="work_events"
		toolbar={{ new: true, title: bolt.t('app.work_events.records') }}
		columns={['catalog_id', 'employment_id', 'from', 'to', 'location', 'description']}
	/>
</AppShell>
