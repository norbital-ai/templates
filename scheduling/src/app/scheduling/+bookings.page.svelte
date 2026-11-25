<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { ListRow } from '@norbital-ai/bolt';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const canUpdateBookings = $derived(ctx.catalog?.bookings?.update !== undefined);

	const bookingActions = $derived(
		canUpdateBookings
			? [
					{
						run: (row: ListRow<'bookings'>) => ctx.run('bookings_cancel', { targets: [row.id] }),
						label: t('app.schedule.cancel_booking'),
						confirm: t('app.schedule.cancel_booking_confirm')
					}
				]
			: []
	);
</script>

{#snippet list()}
	<Table
		{ctx}
		of="bookings"
		order_by={{ number: 'desc' }}
		toolbar={{ title: t('app.schedule.all_bookings') }}
		columns={[
			'number',
			'customer',
			'service',
			'preference',
			'repeat',
			'status',
			'appointment_count'
		]}
		actions={bookingActions}
	/>
{/snippet}

{#snippet requests()}
	<Table
		{ctx}
		of="booking_requests"
		order_by={{ number: 'desc' }}
		initial_filter={{ status: { eq: 'follow_up' } }}
		toolbar={{ title: t('app.schedule.portal_requests'), new: false }}
		columns={['number', 'name', 'email', 'service', 'start', 'status', 'outcome', 'booking']}
	/>
{/snippet}

<AppShell
	icon="lucide:calendar-plus"
	title={t('app.schedule.bookings_title')}
	description={t('app.schedule.bookings_description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'all', title: t('app.schedule.all_bookings'), icon: 'lucide:list', body: list },
			{
				name: 'requests',
				title: t('app.schedule.portal_requests'),
				icon: 'lucide:inbox',
				body: requests
			}
		]}
	/>
</AppShell>
