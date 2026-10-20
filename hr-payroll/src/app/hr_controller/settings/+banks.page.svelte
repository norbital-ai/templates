<script lang="ts">
	import { bolt } from '$bolt';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	icon="lucide:landmark"
	title={bolt.t('app.settings.banks')}
	description={bolt.t('app.settings.banks_help')}
>
	<Table
		of="bank"
		key="payment-banks"
		toolbar={{ title: bolt.t('app.settings.banks'), new: true, export: false }}
		orderBy={{ name: 'asc' }}
		columns={['name', 'code', 'bank_codes', 'currencies', 'enabled']}
	/>
</AppShell>
