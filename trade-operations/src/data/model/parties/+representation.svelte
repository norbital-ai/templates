<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, format, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { openCreate } from '../../../lib/ui/create-values.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'parties'>;
		ctx: PageContext;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const supplier = $derived(
		view.mode !== 'create' && ['supplier', 'both'].includes(view.record.kind)
	);
</script>

{#snippet contacts()}{#if id}<Table
			{ctx}
			of="contacts"
			where={{ party: { eq: id } }}
			columns={['name', 'email', 'phone', 'job_title']}
			toolbar={{
				new: ctx.catalog?.contacts?.create ? () => openCreate('contacts', { party: id }) : false
			}}
		/>{/if}{/snippet}
{#snippet orders()}{#if id}<Table
			{ctx}
			of="orders"
			where={{ party: { eq: id } }}
			columns={['number', 'status', 'ordered_on', 'total']}
			toolbar={{
				new: !ctx.catalog?.orders?.create
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
			{ctx}
			of="credit_snapshots"
			where={{ party: { eq: id } }}
			columns={['currency', 'credit_limit', 'credit_used', 'as_of']}
			toolbar={{ new: false }}
		/>{/if}{/snippet}
<RecordForm
	{ctx}
	after_form={credit}
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
			title: ctx.t('section.sync'),
			closed:
				view.mode === 'create'
					? ''
					: format({ kind: 'instant' }, view.record.source_updated_at, {
							locale: ctx.locale ?? ctx.locale,
							...(ctx.tz == null ? {} : { zone: ctx.tz })
						}),
			fields: ['source_updated_at']
		}
	]}
	tabs={[
		{ name: 'poc', title: ctx.t('component.poc'), body: contacts },
		{ name: 'orders', title: ctx.t('component.orders'), body: orders }
	]}
/>
