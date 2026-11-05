<script lang="ts">
	import { Table } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.commission_rules.label')}
	description={bolt.t('component.commission_rules_hint')}
	variant="full"
	><Table
		of="commission_rules"
		columns={['effective_on', 'currency', 'basis_unit', 'fixed_rate', 'spread_pct', 'active']}
	/></AppShell
>
