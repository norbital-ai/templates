<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		EmptyState,
		RecordShell,
		Table,
		Timeline,
		enum_text,
		format,
		open_record,
		type RecordSection,
		type RecordView,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Scroll, Stack } from '@norbital-ai/ui/layout';
	/**
	 * A customer's profile for the desk: their visits still to come (each with the cleaner it is planned with, or the one
	 * proposed to cover, the shift check and the ETA), their past visits (done or cancelled, with the notes), the bookings
	 * behind them and the notices sent to them.
	 */
	let {
		view,
		ctx
	}: {
		view: RecordView<'customers'>;
		ctx: PageContext;
	} = $props();
	const zone = ctx.tz;
	const t = ctx.t;
	const words: { t(key: string): string } = ctx;
	const record = $derived(view.mode !== 'create' ? view.record : null);
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
	const next = $derived(
		upcomingWhere === null
			? null
			: ctx.query({
					visits: {
						where: upcomingWhere,
						fields: ['slot', 'helper', 'booking'],
						order_by: 'number',
						helper: { fields: ['name'] },
						booking: { fields: ['service'], service: { fields: ['name'] } }
					}
				})
	);
	const past = $derived(
		pastWhere === null
			? null
			: ctx.query({
					visits: {
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
						helper: { fields: ['name'] }
					}
				})
	);
	const historyEntries = $derived<TimelineEntry[]>(
		(past?.current?.visits.rows ?? []).map((v) => ({
			key: v.id,
			icon: v.status === 'done' ? 'lucide:check-circle-2' : 'lucide:x-circle',
			tone: v.status === 'done' ? 'success' : 'danger',
			title: `${v.number} · ${format({ kind: 'instant' }, v.slot.start, { locale: ctx.locale, zone })}`,
			line: [
				enum_text(v.skill, { t: (k) => words.t(k), model: 'visits', field: 'skill' }),
				...(v.helper?.name ? [v.helper.name] : []),
				...(v.completed_at
					? [
							`${t('models.visits.fields.completed_at')} ${format({ kind: 'instant' }, v.completed_at, { locale: ctx.locale, zone })}`
						]
					: [])
			],
			mark: {
				text: enum_text(v.status, { t: (k) => words.t(k), model: 'visits', field: 'status' }),
				variant: v.status === 'done' ? ('success' as const) : ('destructive' as const)
			},
			notes: [
				...(v.late_cancellation
					? [{ kind: 'late', text: t('models.visits.fields.late_cancellation'), warn: true }]
					: []),
				...(v.completion_notes ? [{ kind: 'notes', text: v.completion_notes }] : [])
			],
			onpick: () => open_record('visits', v.id)
		}))
	);
	const soonest = $derived(
		[...(next?.current?.visits.rows ?? [])].sort((a, b) =>
			a.slot.start.localeCompare(b.slot.start)
		)[0]
	);
	const done = $derived(
		(past?.current?.visits.rows ?? []).filter((v) => v.status === 'done').length
	);
	const cancelled = $derived(
		(past?.current?.visits.rows ?? []).filter((v) => v.status === 'cancelled').length
	);
	// who they are, where the work is and their notes stay together; the map pin folds away
	const sections: RecordSection[] = [
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
	];
</script>

{#snippet upcoming()}
	{#if record && upcomingWhere}<Stack size="fill" gap="sm">
			<p class="text-sm text-muted-foreground">
				{soonest === undefined
					? t('app.customers.nothing_ahead')
					: t('app.customers.next_visit', {
							when: format({ kind: 'instant' }, soonest.slot.start, { locale: ctx.locale, zone }),
							service: soonest.booking?.service?.name ?? '',
							cleaner: soonest.helper?.name ?? t('app.customers.cleaner_tbc'),
							count: next?.current?.visits.rows.length ?? 0
						})}
			</p>
			<Table
				{ctx}
				of="visits"
				key="customer-upcoming"
				toolbar={{ title: t('app.customers.upcoming'), new: false }}
				where={upcomingWhere}
				order_by={{ number: 'asc' }}
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
		</Stack>{/if}
{/snippet}
{#snippet history()}
	{#if record && pastWhere}
		<Scroll name={t('app.customers.history')} size="fill" inset>
			<Stack gap="md">
				<p class="text-sm text-muted-foreground">
					{t('app.customers.history_summary', { done, cancelled })}
				</p>
				<Timeline entries={historyEntries} label={t('app.customers.history')}>
					{#snippet empty()}
						<EmptyState title={t('app.customers.history_empty')} />
					{/snippet}
				</Timeline>
			</Stack>
		</Scroll>
	{/if}
{/snippet}
{#snippet bookings()}
	{#if record}<Table
			{ctx}
			of="bookings"
			key="customer-bookings"
			toolbar={{ title: t('app.customers.bookings'), new: false }}
			where={{ customer: { eq: record.id } }}
			order_by={{ number: 'desc' }}
			columns={['number', 'service', 'preference', 'repeat', 'status', 'visit_count']}
		/>{/if}
{/snippet}
{#snippet notices()}
	{#if record}<Table
			{ctx}
			of="customer_notices"
			key="customer-notices"
			toolbar={{ title: t('app.customers.notices'), new: false }}
			where={{ customer: { eq: record.id } }}
			order_by={{ created_at: 'desc' }}
			columns={['subject', 'visit', 'created_at']}
		/>{/if}
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
