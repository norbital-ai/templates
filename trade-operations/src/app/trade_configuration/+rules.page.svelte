<script lang="ts">
	import CreateTable from '../../lib/ui/create-table.svelte';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.commission_rules.label')}
	description={bolt.t('component.commission_rules_hint')}
	variant="full"
	><CreateTable
		of="commission_rules"
		createFields={[
			'currency',
			'effective_on',
			'basis_unit',
			'fixed_rate',
			'spread_pct',
			'active',
			'eligibility_expression',
			'amount_expression',
			'parameters'
		]}
		columns={['effective_on', 'currency', 'basis_unit', 'fixed_rate', 'spread_pct', 'active']}
	/></AppShell
>
