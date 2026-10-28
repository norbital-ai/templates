<script lang="ts">
	import { Table } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	description={bolt.t('app.partners.description')}
	icon="lucide:building-2"
	title={bolt.t('component.partners')}
	variant="full"
>
	<Table of="parties" columns={['name', 'kind', 'external_code', 'active', 'source_updated_at']} />
</AppShell>
