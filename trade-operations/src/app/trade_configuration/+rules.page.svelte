<script lang="ts">
	import CreateTable from '../../lib/ui/create-table.svelte';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.commission_rules.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
	><p>{bolt.t('component.commission_rules_hint')}</p>
	<CreateTable
		of="commission_rules"
		createFields={[
			'code',
			'currency',
			'effective_on',
			'basis_unit',
			'eligibility_expression',
			'amount_expression',
			'parameters',
			'fixed_rate',
			'spread_pct',
			'active'
		]}
		columns={[
			'effective_on',
			'currency',
			'basis_unit',
			'eligibility_expression',
			'amount_expression',
			'active'
		]}
	/></AppShell
>
