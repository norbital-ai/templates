<script lang="ts">
	import { Table, format, useKinds, type RecordView } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { openCreate } from '../../../lib/ui/create-values.js';
	let {
		view
	}: {
		view: RecordView<'parties'>;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const kinds = useKinds();
	const supplier = $derived(
		view.mode !== 'create' && ['supplier', 'both'].includes(view.record.kind)
	);
</script>

{#snippet contacts()}{#if id}<Table
			of="contacts"
			where={{ party: { eq: id } }}
			columns={['name', 'email', 'phone', 'job_title']}
			toolbar={{
				new: kinds.catalog?.contacts?.create ? () => openCreate('contacts', { party: id }) : false
			}}
		/>{/if}{/snippet}
{#snippet orders()}{#if id}<Table
			of="orders"
			where={{ party: { eq: id } }}
			columns={['number', 'status', 'ordered_on', 'total']}
			toolbar={{
				new: !kinds.catalog?.orders?.create
					? false
					: () =>
							openCreate('orders', {
								party: id,
								direction: supplier ? 'purchasing' : 'sales',
								...(supplier ? { payment_terms: '' } : {}),
								...(view.mode !== 'create' ? { currency: view.record.currency } : {})
							})
			}}
		/>{/if}{/snippet}

{#snippet credit()}{#if id && !supplier}<Table
			of="credit_snapshots"
			where={{ party: { eq: id } }}
			columns={['currency', 'credit_limit', 'credit_used', 'as_of']}
			toolbar={{ new: false }}
		/>{/if}{/snippet}
<RecordForm
	afterForm={credit}
	{view}
	sections={[
		{
			name: 'partner',
			fields: ['name', 'external_code', 'kind', 'currency', 'active', 'address', 'phone'],
			wide: ['address']
		},
		{
			name: 'sync',
			icon: 'lucide:refresh-cw',
			title: bolt.t('section.sync'),
			closed:
				view.mode === 'create'
					? ''
					: format({ kind: 'instant' }, view.record.source_updated_at, {
							locale: kinds.locale ?? bolt.locale,
							...(kinds.zone == null ? {} : { zone: kinds.zone })
						}),
			fields: ['source_updated_at']
		}
	]}
	tabs={[
		{ name: 'poc', title: bolt.t('component.poc'), body: contacts },
		{ name: 'orders', title: bolt.t('component.orders'), body: orders }
	]}
/>
