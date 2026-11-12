<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
</script>

<AppShell
	description={ctx.t('app.partners.description')}
	icon="lucide:building-2"
	title={ctx.t('component.partners')}
	variant="full"
>
	<Table of="parties" columns={['name', 'kind', 'external_code', 'active', 'source_updated_at']} />
</AppShell>
