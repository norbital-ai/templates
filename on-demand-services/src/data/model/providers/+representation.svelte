<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		type RecordSection,
		type RecordView,
		format,
		RecordShell,
		Sheet,
		Table
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'providers'>; ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canCreateTimeOff = $derived(ctx.catalog?.provider_time_off?.create !== undefined);
	let addingTimeOff = $state(false);

	const sections = $derived<RecordSection[]>([
		{
			name: 'provider',
			icon: 'lucide:user-round',
			title: t('models.providers.singular'),
			fields: ['name', 'phone', 'email', 'status', 'inactive_since', 'skills']
		},
		{
			name: 'availability',
			icon: 'lucide:calendar-clock',
			title: t('section.availability'),
			fields: ['work_days', 'day_start', 'day_end']
		},
		{
			name: 'account_location',
			icon: 'lucide:map-pin',
			title: t('section.account_location'),
			fields:
				record === null
					? ['user', 'home_location']
					: ['user', 'home_location', 'last_location', 'last_location_at'],
			default_open: false,
			summary: (r) =>
				r.last_location_at == null
					? t('summary.no_location')
					: t('summary.last_seen', {
							at: format({ kind: 'instant' }, String(r.last_location_at), {
								locale: ctx.locale,
								zone: ctx.tz
							})
						})
		}
	]);
</script>

{#snippet appointments()}
	{#if record}
		<Table
			{ctx}
			of="appointments"
			key="provider-appointments"
			toolbar={{ title: t('app.providers.appointments'), new: false }}
			where={{ provider: { eq: record.id } }}
			initial_filter={{ status: { in: ['scheduled', 'in_progress'] } }}
			order_by={{ number: 'asc' }}
			columns={['number', 'slot', 'address', 'status', 'shift_check']}
		/>
	{/if}
{/snippet}

{#snippet timeOff()}
	{#if record}
		<Table
			{ctx}
			of="provider_time_off"
			key="provider-time-off"
			toolbar={{
				title: t('app.providers.time_off'),
				new: canCreateTimeOff ? () => (addingTimeOff = true) : false
			}}
			where={{ provider: { eq: record.id } }}
			columns={['period', 'reason']}
		/>
	{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="providers"
		fields={[
			'name',
			'phone',
			'email',
			'status',
			'inactive_since',
			'skills',
			'work_days',
			'day_start',
			'day_end',
			'user',
			'home_location'
		]}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell
		{ctx}
		of="providers"
		fields={[
			'name',
			'phone',
			'email',
			'status',
			'inactive_since',
			'skills',
			'work_days',
			'day_start',
			'day_end',
			'user',
			'home_location',
			'last_location',
			'last_location_at'
		]}
		id={record.id}
		title={record.name}
		{sections}
		tabs={[
			{
				name: 'appointments',
				title: t('app.providers.appointments'),
				icon: 'lucide:calendar-clock',
				body: appointments
			},
			{
				name: 'time_off',
				title: t('app.providers.time_off'),
				icon: 'lucide:calendar-off',
				body: timeOff
			}
		]}
	/>

	<Sheet
		open={addingTimeOff}
		on_open_change={(open) => {
			addingTimeOff = open;
		}}
		title={t('models.provider_time_off.singular')}
	>
		{#if addingTimeOff}
			<RecordShell
				{ctx}
				of="provider_time_off"
				mode="create"
				values={{ provider: record.id }}
				on_done={() => {
					addingTimeOff = false;
				}}
			/>
		{/if}
	</Sheet>
{/if}
