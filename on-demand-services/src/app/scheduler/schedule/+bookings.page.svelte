<script lang="ts">
	/**
	 * Every booking, taken with the toolbar's New (the booking's own form). Requests from the public portal that could
	 * not be booked on their own wait in Portal requests.
	 */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, Tabs } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

{#snippet list()}
	<Table
		of="bookings"
		orderBy={{ number: 'desc' }}
		toolbar={{ title: t('app.schedule.all_bookings') }}
		columns={['number', 'customer', 'service', 'preference', 'repeat', 'status', 'visit_count']}
		actions={[
			{
				action: 'bookings.cancel',
				label: t('app.schedule.cancel_booking'),
				confirm: t('app.schedule.cancel_booking_confirm')
			}
		]}
	/>
{/snippet}

{#snippet requests()}
	<Table
		of="booking_requests"
		orderBy={{ number: 'desc' }}
		initialFilter={{ status: { eq: 'follow_up' } }}
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
