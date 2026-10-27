<script lang="ts">
	import { progressOf, progressRead } from '../../../lib/partner-progress.js';
	import OrderCreateFields from '../../../lib/ui/order-create-fields.svelte';
	import { type FormState, Table, Badge, format, useKinds, type RecordView } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { Stack } from '@norbital-ai/ui/layout';
	import CreateTable from '../../../lib/ui/create-table.svelte';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'parties'>;
	} = $props();
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const kinds = useKinds();
	const clock = bolt.clock('day');
	const progressAnswer = $derived(
		id && kinds.catalog?.source_sales_lines ? bolt.query(progressRead(id)) : null
	);
	const progressRows = $derived(
		progressAnswer?.current ? progressOf(progressAnswer.current, clock.today) : null
	);
	const supplier = $derived(
		view.mode !== 'create' && ['supplier', 'both'].includes(view.record.kind)
	);
</script>

{#snippet orderFields(form: FormState)}<OrderCreateFields {form} scoped />{/snippet}
{#snippet contacts()}{#if id}<CreateTable
			of="contacts"
			where={{ party: { eq: id } }}
			columns={['name', 'email', 'phone', 'job_title']}
			createValues={{ party: id }}
		/>{/if}{/snippet}
{#snippet orders()}{#if id}<CreateTable
			of="orders"
			where={{ party: { eq: id } }}
			columns={['number', 'status', 'ordered_on', 'total']}
			createValues={{
				party: id,
				direction: supplier ? 'purchasing' : 'sales',
				...(view.mode !== 'create' ? { currency: view.record.currency } : {})
			}}
			createForm={orderFields}
		/>{/if}{/snippet}
{#snippet progressState({
	row
}: {
	row: Pick<ReturnType<typeof progressOf>[number], 'state'>;
})}<Badge variant={row.state === 'overdue' || row.state === 'late' ? 'warning' : 'outline'}
		>{bolt.t(`component.progress_${row.state}`)}</Badge
	>{/snippet}
{#snippet progress()}{#if progressRows}<Table
			layout="grid"
			of={progressRows}
			key="partner_progress"
			columns={[
				{ field: 'number', label: bolt.t('models.orders.singular') },
				{ field: 'sku', label: bolt.t('reports.sales.product') },
				{ field: 'unit', label: bolt.t('reports.sales.unit') },
				{ field: 'quota', label: bolt.t('models.order_lines.fields.quantity') },
				{ field: 'delivered', label: bolt.t('component.delivered_quantity') },
				{ field: 'fulfillment', label: bolt.t('component.fulfillment') },
				{ field: 'currency', label: bolt.t('models.orders.fields.currency') },
				{ field: 'forecast', label: bolt.t('component.forecast_value') },
				{ field: 'actual', label: bolt.t('component.actual_value') },
				{ field: 'valid_until', label: bolt.t('models.orders.fields.valid_until') },
				{ field: 'state', label: bolt.t('models.orders.fields.status'), cell: progressState }
			]}
			toolbar={{ new: false, title: bolt.t('component.partner_progress') }}
		/>{/if}{/snippet}

{#snippet credit()}{#if id && !supplier}<Table
			of="credit_snapshots"
			where={{ party: { eq: id } }}
			columns={['currency', 'credit_limit', 'credit_used', 'as_of']}
			toolbar={{ new: false }}
		/>{/if}{/snippet}
{#snippet partnerOrders()}<Stack gap="lg">
		{@render orders()}{@render progress()}
	</Stack>{/snippet}
<RecordForm
	afterForm={credit}
	{view}
	mainTitle={bolt.t('section.general')}
	sections={[
		{
			name: 'partner',
			title: bolt.t('component.partners'),
			fields: ['name', 'external_code', 'kind', 'currency', 'active', 'address', 'phone'],
			wide: ['address']
		},
		{
			name: 'sync',
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
		{ name: 'orders', title: bolt.t('component.orders'), body: partnerOrders }
	]}
/>
