<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { ListRow } from '@norbital-ai/bolt';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const clock = $derived(ctx.clock('day'));
	const canUpdate = $derived(ctx.catalog?.providers?.update !== undefined);

	const providerActions = $derived(
		canUpdate
			? [
					{
						run: (row: ListRow<'providers'>) =>
							ctx.run('providers_deactivate', { targets: [row.id], last_day: clock.today }),
						label: t('app.providers.deactivate'),
						confirm: t('app.providers.deactivate_confirm')
					}
				]
			: []
	);
</script>

<AppShell
	icon="lucide:users"
	title={t('app.providers.title')}
	description={t('app.providers.description')}
>
	<Table
		{ctx}
		of="providers"
		initial_filter={{ status: { eq: 'active' } }}
		order_by={{ name: 'asc' }}
		toolbar={{ title: t('app.providers.tab_profiles') }}
		columns={['name', 'phone', 'skills', 'work_days', 'day_start', 'day_end', 'status']}
		actions={providerActions}
	/>
</AppShell>
