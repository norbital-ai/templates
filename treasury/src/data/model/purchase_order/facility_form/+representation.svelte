<script lang="ts">
	/**
	 * A facility form: starting one asks only for its attachments, which fill the form as they land; then its fields
	 * and attachments (the generated form). PDF pack downloads live in the Facility forms toolbar.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'facility_form'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const evidence: RecordSection = {
		name: 'evidence',
		icon: 'lucide:paperclip',
		title: t('app.sections.evidence'),
		fields: ['attachments']
	};
	const sections: readonly RecordSection[] = [
		{
			name: 'request',
			icon: 'lucide:file-pen-line',
			title: t('app.sections.request'),
			fields: [
				'purchase_order',
				'po_number',
				'po_date',
				'vendor',
				'buyer',
				'requested_by',
				'facility_required',
				'currency',
				'amount',
				'pay_by_date',
				'customer_po_number'
			]
		},
		{
			name: 'shipment',
			icon: 'lucide:ship',
			title: t('app.sections.shipment'),
			fields: [
				'ship_date',
				'shipping_terms',
				'latest_shipment_date',
				'shipment_from',
				'shipment_to',
				'freight',
				'partial_shipment',
				'transhipment',
				'expected_arrival'
			]
		},
		{
			name: 'credit',
			icon: 'lucide:credit-card',
			title: t('app.sections.credit'),
			fields: ['payment_terms', 'lc_expiry_date', 'documents_presentation_days']
		},
		{
			name: 'planning',
			icon: 'lucide:calendar-clock',
			title: t('app.sections.planning'),
			fields: ['purpose', 'product_description', 'intended_period_of_sales', 'projected_sales'],
			default_open: false
		},
		{ ...evidence, default_open: false },
		{
			name: 'notes',
			icon: 'lucide:notebook-pen',
			title: t('app.sections.notes'),
			fields: ['remarks', 'read_note'],
			default_open: false
		}
	];

	const attach: readonly RecordSection[] = [evidence];

	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#if record === null}
	<RecordShell
		{ctx}
		of="facility_form"
		sections={attach}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		footer={t('app.forms.upload_hint')}
	/>
{:else}
	<RecordShell
		{ctx}
		of="facility_form"
		{sections}
		id={record.id}
		subtitle={['vendor', 'pay_by_date']}
		{...record.read_note === null ? {} : { hint: record.read_note }}
	/>
{/if}
