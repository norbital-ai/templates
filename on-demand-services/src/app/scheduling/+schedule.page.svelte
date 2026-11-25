<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { ListRow, Row } from '@norbital-ai/bolt';
	import { Alert, Badge, Board, Label, StateBadge, Table, Tabs, TimeInput } from '@norbital-ai/ui';
	import { AppShell, Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { DateTime } from 'effect';
	import { formatInstant } from '../../lib/format.js';

	let { ctx }: { ctx: PageContext } = $props();
	const uid = $props.id();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const clock = $derived(ctx.clock('day'));
	const canUpdate = $derived(ctx.catalog?.appointments?.update !== undefined);

	type Appointment = Row<'appointments'>;
	const word = (
		key:
			| `status.${Appointment['status']}`
			| `shift_check.${Appointment['shift_check']}`
			| `attention.${Appointment['attention']}`
	) => ctx.t(`models.appointments.fields.${key}`);

	let activeTab = $state('by_provider');
	let dayOverride = $state<string | null>(null);
	const day = $derived(dayOverride ?? clock.today);

	const span = $derived({
		start: DateTime.formatIso(
			DateTime.makeZonedUnsafe(day, { timeZone: zone, adjustForTimeZone: true })
		),
		end: DateTime.formatIso(
			DateTime.add(DateTime.makeZonedUnsafe(day, { timeZone: zone, adjustForTimeZone: true }), {
				days: 1
			})
		)
	});

	const providers = $derived(
		activeTab !== 'by_provider'
			? null
			: ctx.query({
					providers: {
						where: { status: { eq: 'active' } },
						fields: ['name'],
						order_by: { name: 'asc' },
						limit: 200
					}
				})
	);
	const lanes = $derived([
		{ value: null, label: t('app.schedule.unassigned') },
		...(providers?.current?.providers.rows ?? []).map((p) => ({ value: p.id, label: p.name }))
	]);

	const where = $derived({ slot: { overlaps: span }, status: { ne: 'cancelled' as const } });
	const booked = $derived(
		activeTab !== 'by_provider'
			? null
			: ctx.query({
					appointments: {
						where,
						fields: ['booking'],
						limit: 500,
						booking: {
							fields: ['customer', 'service'],
							customer: { fields: ['name'] },
							service: { fields: ['name'] }
						}
					}
				})
	);
	const forWhom = $derived(
		new globalThis.Map(
			(booked?.current?.appointments.rows ?? []).map((a) => [
				a.id,
				`${a.booking?.customer?.name ?? '—'} · ${a.booking?.service?.name ?? '—'}`
			])
		)
	);

	const clockTime = (iso: string) =>
		formatInstant(iso, zone, { hour: 'numeric', minute: '2-digit' }, ctx.locale);

	const rowActions = $derived(
		canUpdate
			? [
					{
						run: (row: ListRow<'appointments'>) =>
							ctx.run('appointments_recommend', { targets: [row.id] }),
						label: t('app.schedule.auto_reassign')
					},
					{
						run: (row: ListRow<'appointments'>) =>
							ctx.run('appointments_cancel', { targets: [row.id] }),
						label: t('app.schedule.cancel_appointment'),
						confirm: t('app.schedule.cancel_appointment_confirm')
					}
				]
			: []
	);
</script>

{#snippet dayPicker()}
	<Inline gap="sm" align="center">
		<Label for={`${uid}-day`} class="sr-only">{t('app.schedule.date')}</Label>
		<TimeInput
			id={`${uid}-day`}
			{ctx}
			value={day}
			on_change={(next: string | null) => (dayOverride = next ?? clock.today)}
		/>
	</Inline>
{/snippet}

{#snippet card({ row }: { row: ListRow<'appointments'> })}
	<Stack gap="xs">
		<Cluster gap="xs" justify="between" align="center">
			<p class="text-sm font-medium tabular-nums">
				{clockTime(row.slot.start)} – {row.slot.end === null ? '—' : clockTime(row.slot.end)}
			</p>
		</Cluster>
		<p class="line-clamp-1 text-sm">{forWhom.get(row.id) ?? '—'}</p>
		<p class="line-clamp-1 text-meta">{row.address}</p>
		<Cluster gap="xs">
			{#if row.status !== 'scheduled'}
				<StateBadge {ctx} state={row.status} label={word(`status.${row.status}`)} />
			{:else if row.shift_check !== undefined && row.shift_check !== 'not_due'}
				<Badge variant="outline">{word(`shift_check.${row.shift_check}`)}</Badge>
			{/if}
			{#if row.attention !== undefined && row.attention !== 'none'}
				<Badge variant="warning">{word(`attention.${row.attention}`)}</Badge>
			{/if}
			{#if row.status === 'scheduled' && row.eta_minutes != null}
				<Badge variant="outline">{t('component.eta', { minutes: row.eta_minutes })}</Badge>
			{/if}
		</Cluster>
	</Stack>
{/snippet}

{#snippet byProvider()}
	{#if providers?.error || booked?.error}
		<Alert.Root variant="destructive">
			<Alert.Title>{(providers?.error ?? booked?.error)?.message}</Alert.Title>
		</Alert.Root>
	{:else}
		<Board
			{ctx}
			of="appointments"
			key="by-provider"
			by="provider"
			{lanes}
			{where}
			{card}
			order_by={{ number: 'asc' }}
			toolbar={{ title: t('app.schedule.by_provider'), new: false }}
		/>
	{/if}
{/snippet}

{#snippet list()}
	<Table
		{ctx}
		of="appointments"
		key="list"
		{where}
		order_by={{ number: 'asc' }}
		toolbar={{ title: t('app.schedule.list'), new: false }}
		columns={['number', 'slot', 'provider', 'address', 'status', 'shift_check', 'eta_minutes']}
		actions={rowActions}
	/>
{/snippet}

<AppShell
	icon="lucide:kanban"
	title={t('app.schedule.board_title')}
	description={t('app.schedule.board_description')}
	variant="full"
>
	{#snippet actions()}{@render dayPicker()}{/snippet}
	<Tabs
		value={activeTab}
		on_value_change={(next) => (activeTab = next)}
		tabs={[
			{
				name: 'by_provider',
				title: t('app.schedule.by_provider'),
				icon: 'lucide:kanban',
				body: byProvider
			},
			{ name: 'list', title: t('app.schedule.list'), icon: 'lucide:list', body: list }
		]}
	/>
</AppShell>
