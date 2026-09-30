<script lang="ts">
	/** A customer's profile, with their bookings and the notices sent to them. */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'customers'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

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
	<RecordShell of="customers" mode="create" values={view.mode === 'create' ? view.values : {}} />
{:else}
	<RecordShell
		of="customers"
		id={record.id}
		title={record.name}
		tabs={[
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
