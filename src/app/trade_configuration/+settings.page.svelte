<script lang="ts">
	import CreateTable from '../../lib/ui/create-table.svelte';
	import { bolt } from '$bolt';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.commercial_settings.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
	><CreateTable
		of="commercial_settings"
		columns={['code', 'freight_treatment', 'require_floor']}
	/></AppShell
>
