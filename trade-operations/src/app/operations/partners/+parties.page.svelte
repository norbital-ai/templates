<script lang="ts">
	import CreateTable from '../../../lib/ui/create-table.svelte';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	description=""
	icon="lucide:building-2"
	title={bolt.t('component.partners')}
	variant="full"
>
	<CreateTable
		of="parties"
		columns={['name', 'kind', 'external_code', 'active', 'source_updated_at']}
	/>
</AppShell>
