<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Table } from '@norbital-ai/ui';
	/** Every helper: skills, working hours and area. Open one for their visits, time off and warnings. */
	import { AppShell } from '@norbital-ai/ui/layout';
	const t = ctx.t;
	const clock = ctx.clock('day');
</script>

<AppShell
	icon="lucide:users"
	title={t('app.helpers.title')}
	description={t('app.helpers.description')}
>
	<Table
		of="helpers"
		initial_filter={{ status: { eq: 'active' } }}
		order_by={{ name: 'asc' }}
		toolbar={{ title: t('app.helpers.tab_profiles') }}
		columns={['name', 'phone', 'skills', 'work_days', 'day_start', 'day_end', 'status']}
		actions={[
			{
				run: (row) => ctx.run('helpers_offboard', { targets: [row.id], last_day: clock.today }),
				label: t('app.helpers.offboard'),
				confirm: t('app.helpers.offboard_confirm')
			}
		]}
	/>
</AppShell>
