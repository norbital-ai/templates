<script lang="ts">
	/**
	 * A customer's profile for the desk: their visits still to come (each with the cleaner it is planned with, or the one
	 * proposed to cover, the shift check and the ETA), their past visits (done or cancelled, with the notes), the bookings
	 * behind them and the notices sent to them.
	 */
	import { bolt } from '$bolt';
	import { live } from '../../../lib/live.svelte.js';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { excerpt } from '../../../lib/summary.js';

	let { view }: { view: RecordView<'customers'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
	/** Their visits through their bookings. */
	const theirs = $derived(
		record === null ? null : { booking: { is: { customer: { eq: record.id } } } }
	);
	const upcomingWhere = $derived(
		theirs === null
			? null
			: { ...theirs, status: { in: ['scheduled' as const, 'in_progress' as const] } }
	);
	const pastWhere = $derived(
		theirs === null ? null : { ...theirs, status: { in: ['done' as const, 'cancelled' as const] } }
	);
	// the headline: what is next, and how much is ahead and behind
	const next = live(() =>
		upcomingWhere === null
			? null
			: bolt.read('visits', {
					where: upcomingWhere,
					select: {
						slot: true,
						helper: { select: { name: true } },
						booking: { select: { service: { select: { name: true } } } }
					},
					orderBy: { number: 'asc' },
					all: true
				})
	);
	const past = live(() =>
		pastWhere === null
			? null
			: bolt.read('visits', { where: pastWhere, select: { status: true }, all: true })
	);
	const soonest = $derived(
		[...(next.current?.rows ?? [])].sort((a, b) => a.slot.start.localeCompare(b.slot.start))[0]
	);
	const when = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(i));
	const done = $derived((past.current?.rows ?? []).filter((v) => v.status === 'done').length);
	const cancelled = $derived(
		(past.current?.rows ?? []).filter((v) => v.status === 'cancelled').length
	);
	// who they are and where the work is stay open; notes and the map pin fold away
	const sections: RecordSection[] = [
		{
			name: 'customer',
			title: t('models.customers.singular'),
			fields: ['name', 'phone', 'email', 'address']
		},
		{
			name: 'notes',
			title: t('section.notes'),
			fields: ['notes'],
			defaultOpen: false,
			summary: (r) => excerpt(r.notes) || t('summary.no_notes')
		},
		{
			name: 'map',
			title: t('section.map'),
			fields: ['location'],
			defaultOpen: false,
			summary: (r) => (r.location == null ? t('summary.not_set') : t('summary.pinned'))
		}
	];
</script>

{#snippet upcoming()}
	{#if record && upcomingWhere}
		<p class="pb-2 text-sm text-muted-foreground">
			{soonest === undefined
				? t('app.customers.nothing_ahead')
				: t('app.customers.next_visit', {
						when: when(soonest.slot.start),
						service: soonest.booking.service.name,
						cleaner: soonest.helper?.name ?? t('app.customers.cleaner_tbc'),
						count: next.current?.rows.length ?? 0
					})}
		</p>
		<Table
			of="visits"
			key="customer-upcoming"
			toolbar={{ title: t('app.customers.upcoming'), new: false }}
			where={upcomingWhere}
			orderBy={{ number: 'asc' }}
			columns={[
				'number',
				'slot',
				'helper',
				'proposed_helper',
				'skill',
				'status',
				'shift_check',
				'eta_minutes',
				'attention'
			]}
		/>
	{/if}
{/snippet}
{#snippet history()}
	{#if record && pastWhere}
		<p class="pb-2 text-sm text-muted-foreground">
			{t('app.customers.history_summary', { done, cancelled })}
		</p>
		<Table
			of="visits"
			key="customer-history"
			toolbar={{ title: t('app.customers.history'), new: false }}
			where={pastWhere}
			orderBy={{ number: 'desc' }}
			columns={[
				'number',
				'slot',
				'helper',
				'skill',
				'status',
				'completed_at',
				'completion_notes',
				'late_cancellation'
			]}
		/>
	{/if}
{/snippet}
{#snippet bookings()}
	{#if record}<Table
			of="bookings"
			key="customer-bookings"
			toolbar={{ title: t('app.customers.bookings'), new: false }}
			where={{ customer: { eq: record.id } }}
			orderBy={{ number: 'desc' }}
			columns={['number', 'service', 'preference', 'repeat', 'status', 'visit_count']}
		/>{/if}
{/snippet}
{#snippet notices()}
	{#if record}<Table
			of="customer_notices"
			key="customer-notices"
			toolbar={{ title: t('app.customers.notices'), new: false }}
			where={{ customer: { eq: record.id } }}
			orderBy={{ created_at: 'desc' }}
			columns={['subject', 'visit', 'created_at']}
		/>{/if}
{/snippet}

{#if record === null}
	<RecordShell
		of="customers"
		fields={['name', 'phone', 'email', 'address', 'notes', 'location']}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell
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
			{ name: 'history', title: t('app.customers.history'), icon: 'lucide:history', body: history },
			{
				name: 'bookings',
				title: t('app.customers.bookings'),
				icon: 'lucide:calendar-check',
				body: bookings
			},
			{ name: 'notices', title: t('app.customers.notices'), icon: 'lucide:mail', body: notices }
		]}
	/>
{/if}
