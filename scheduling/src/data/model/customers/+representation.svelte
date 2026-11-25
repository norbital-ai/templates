<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		EmptyState,
		RecordShell,
		Sheet,
		Spinner,
		Table,
		Timeline,
		format,
		open_record,
		type RecordSection,
		type RecordView,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import { setContext } from 'svelte';

	const BOOKING_DONE = Symbol.for('scheduling.booking_done');

	let { view, ctx }: { view: RecordView<'customers'>; ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const canCreateBooking = $derived(ctx.catalog?.bookings?.create !== undefined);
	let addingBooking = $state(false);
	setContext(BOOKING_DONE, () => {
		addingBooking = false;
	});

	const theirs = $derived(
		record === null ? null : { booking: { is: { customer: { eq: record.id } } } }
	);
	const upcomingWhere = $derived(
		theirs === null
			? null
			: { ...theirs, status: { in: ['scheduled' as const, 'in_progress' as const] } }
	);
	const pastWhere = $derived(
		theirs === null
			? null
			: { ...theirs, status: { in: ['completed' as const, 'cancelled' as const] } }
	);

	const past = $derived(
		pastWhere === null
			? null
			: ctx.query({
					appointments: {
						where: pastWhere,
						fields: [
							'number',
							'slot',
							'skill',
							'status',
							'completed_at',
							'completion_notes',
							'late_cancellation'
						],
						order_by: { number: 'desc' },
						limit: 100,
						provider: { fields: ['name'] }
					}
				})
	);

	const historyEntries = $derived<TimelineEntry[]>(
		(past?.current?.appointments.rows ?? []).map((a) => ({
			key: a.id,
			icon: a.status === 'completed' ? 'lucide:check-circle-2' : 'lucide:x-circle',
			tone: a.status === 'completed' ? 'success' : 'danger',
			title: `${a.number} · ${format({ kind: 'instant' }, a.slot.start, { locale: ctx.locale, zone })}`,
			line: [
				a.skill,
				...(a.provider?.name ? [a.provider.name] : []),
				...(a.completed_at
					? [
							`${t('models.appointments.fields.completed_at')} ${format({ kind: 'instant' }, a.completed_at, { locale: ctx.locale, zone })}`
						]
					: [])
			],
			mark: {
				text: t(
					a.status === 'completed'
						? 'models.appointments.fields.status.completed'
						: 'models.appointments.fields.status.cancelled'
				),
				variant: a.status === 'completed' ? ('success' as const) : ('destructive' as const)
			},
			notes: [
				...(a.late_cancellation
					? [{ kind: 'late', text: t('models.appointments.fields.late_cancellation'), warn: true }]
					: []),
				...(a.completion_notes ? [{ kind: 'notes', text: a.completion_notes }] : [])
			],
			onpick: () => open_record('appointments', a.id)
		}))
	);

	const completedCount = $derived(
		(past?.current?.appointments.rows ?? []).filter((a) => a.status === 'completed').length
	);
	const cancelledCount = $derived(
		(past?.current?.appointments.rows ?? []).filter((a) => a.status === 'cancelled').length
	);

	const sections = $derived<RecordSection[]>([
		{
			name: 'customer',
			icon: 'lucide:user-round',
			title: t('models.customers.singular'),
			fields: ['name', 'phone', 'email', 'address', 'notes']
		},
		{
			name: 'map',
			icon: 'lucide:map',
			title: t('section.map'),
			fields: ['location'],
			default_open: false,
			summary: (r) => (r.location == null ? t('summary.not_set') : t('summary.pinned'))
		}
	]);
</script>

{#snippet upcoming()}
	{#if record && upcomingWhere}
		<Table
			{ctx}
			of="appointments"
			key="customer-upcoming"
			toolbar={{ title: t('app.customers.upcoming'), new: false }}
			where={upcomingWhere}
			order_by={{ number: 'asc' }}
			columns={[
				'number',
				'slot',
				'provider',
				'proposed_provider',
				'skill',
				'status',
				'shift_check',
				'eta_minutes',
				'attention'
			]}
		/>
	{/if}
{/snippet}

{#snippet pastAppointments()}
	{#if record && pastWhere}
		<Scroll name={t('app.customers.past_appointments')} size="fill" inset>
			<Stack gap="md">
				{#if past?.error}
					<Alert.Root variant="destructive">
						<Alert.Title>{past.error.message}</Alert.Title>
					</Alert.Root>
				{:else if past?.current === undefined}
					<Surface tone="subtle" padding="md" radius="control" aria-busy="true">
						<Inline gap="sm" align="center">
							<Spinner />
							<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
						</Inline>
					</Surface>
				{:else}
					<p class="text-sm text-muted-foreground">
						{t('app.customers.history_summary', {
							completed: completedCount,
							cancelled: cancelledCount
						})}
					</p>
					<Timeline entries={historyEntries} label={t('app.customers.past_appointments')}>
						{#snippet empty()}
							<EmptyState title={t('app.customers.history_empty')} />
						{/snippet}
					</Timeline>
				{/if}
			</Stack>
		</Scroll>
	{/if}
{/snippet}

{#snippet bookings()}
	{#if record}
		<Table
			{ctx}
			of="bookings"
			key="customer-bookings"
			toolbar={{
				title: t('app.customers.bookings'),
				new: canCreateBooking ? () => (addingBooking = true) : false
			}}
			where={{ customer: { eq: record.id } }}
			order_by={{ number: 'desc' }}
			columns={['number', 'service', 'preference', 'repeat', 'status', 'appointment_count']}
		/>
	{/if}
{/snippet}

{#snippet notices()}
	{#if record}
		<Table
			{ctx}
			of="customer_notices"
			key="customer-notices"
			toolbar={{ title: t('app.customers.notices'), new: false }}
			where={{ customer: { eq: record.id } }}
			order_by={{ created_at: 'desc' }}
			columns={['subject', 'appointment', 'created_at']}
		/>
	{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="customers"
		fields={['name', 'phone', 'email', 'address', 'notes', 'location']}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell
		{ctx}
		of="customers"
		fields={['name', 'phone', 'email', 'address', 'notes', 'location']}
		id={record.id}
		title={record.name}
		{sections}
		tabs={[
			{
				name: 'upcoming',
				title: t('app.customers.upcoming'),
				icon: 'lucide:calendar-clock',
				body: upcoming
			},
			{
				name: 'past_appointments',
				title: t('app.customers.past_appointments'),
				icon: 'lucide:calendar-check-2',
				body: pastAppointments
			},
			{
				name: 'bookings',
				title: t('app.customers.bookings'),
				icon: 'lucide:calendar-check',
				body: bookings
			},
			{ name: 'notices', title: t('app.customers.notices'), icon: 'lucide:mail', body: notices }
		]}
	/>

	<Sheet
		open={addingBooking}
		on_open_change={(open) => {
			addingBooking = open;
		}}
		title={t('models.bookings.singular')}
	>
		{#if addingBooking}
			<RecordShell
				{ctx}
				of="bookings"
				mode="create"
				values={{ customer: record.id }}
				on_done={() => {
					addingBooking = false;
				}}
			/>
		{/if}
	</Sheet>
{/if}
