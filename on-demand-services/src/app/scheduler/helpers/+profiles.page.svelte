<script lang="ts">
	/** Every helper: skills, working hours and area. Open one for their visits, time off and warnings. */
	import { bolt } from '$bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	const t = bolt.t;
	const today = PlainDate(new Intl.DateTimeFormat('en-CA').format(new Date()));
</script>

<AppShell
	icon="lucide:users"
	title={t('app.helpers.title')}
	description={t('app.helpers.description')}
>
	<Table
		of="helpers"
		initialFilter={{ status: { eq: 'active' } }}
		orderBy={{ name: 'asc' }}
		toolbar={{ title: t('app.helpers.tab_profiles') }}
		columns={['name', 'phone', 'skills', 'work_days', 'day_start', 'day_end', 'status']}
		actions={[
			{
				action: 'helpers.offboard',
				label: t('app.helpers.offboard'),
				confirm: t('app.helpers.offboard_confirm'),
				input: (row) => ({ target: row.id, input: { last_day: today } })
			}
		]}
	/>
</AppShell>
