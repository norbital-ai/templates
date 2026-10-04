<script lang="ts">
	/** A customer's profile, with their bookings and the notices sent to them. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { excerpt } from '../../../lib/summary.js';

	let { view }: { view: RecordView<'customers'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
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
				name: 'bookings',
				title: t('app.customers.bookings'),
				icon: 'lucide:calendar-check',
				body: bookings
			},
			{ name: 'notices', title: t('app.customers.notices'), icon: 'lucide:mail', body: notices }
		]}
	/>
{/if}
