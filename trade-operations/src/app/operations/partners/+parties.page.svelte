<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { EmptyState, Table } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import {
		kingdeeIntegrationRead,
		workspaceKingdeeSummary
	} from '../../../integration/kingdee/connection-status.js';
	import KingdeeStatusBanner from '../../../lib/ui/kingdee-status-banner.svelte';

	const kingdeeRead = $derived(
		ctx.catalog?.sys_integration ? ctx.query(kingdeeIntegrationRead) : null
	);
	const kingdeeInstances = $derived(kingdeeRead?.current?.sys_integration.rows ?? null);
	const disconnected = $derived(
		kingdeeInstances !== null && workspaceKingdeeSummary(kingdeeInstances).state !== 'connected'
	);
</script>

<AppShell
	description={ctx.t('app.partners.description')}
	icon="lucide:building-2"
	title={ctx.t('component.partners')}
>
	<Stack size="fill" gap="sm">
		<KingdeeStatusBanner {ctx} instances={kingdeeInstances} />
		<Table
			{ctx}
			of="parties"
			columns={[
				'name',
				'kind',
				'region',
				'related_party',
				'external_code',
				'source_number',
				'tax_id',
				'active',
				'source_updated_at'
			]}
			toolbar={{ new: false }}
		>
			{#snippet empty()}
				<EmptyState
					title={ctx.t('component.parties_empty')}
					{...disconnected ? { description: ctx.t('component.kingdee_empty_connect_hint') } : {}}
				/>
			{/snippet}
		</Table>
	</Stack>
</AppShell>
