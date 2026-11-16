<script lang="ts">
	/** A facility form: its fields and attachments (the generated form), and Fill from attachments in the footer. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		RecordShell,
		RunStatus,
		use_act,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'facility_form'>; ctx: PageContext } = $props();
	const t = ctx.t;
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
		{
			name: 'evidence',
			icon: 'lucide:paperclip',
			title: t('app.sections.evidence'),
			fields: ['attachments'],
			default_open: false
		},
		{
			name: 'notes',
			icon: 'lucide:notebook-pen',
			title: t('app.sections.notes'),
			fields: ['remarks', 'read_note'],
			default_open: false
		}
	];

	const record = $derived(view.mode === 'create' ? null : view.record);
	const act = use_act(ctx);
	let run = $state<string | null>(null);
	let automation = $state<'facility_form_read' | 'facility_form_pack'>('facility_form_read');
	const start = (which: typeof automation) => {
		if (record === null) return;
		const handle = ctx.run(which, { form: [record.id] });
		automation = which;
		run = handle.id;
		act.run(handle);
	};
</script>

{#snippet fill()}
	{#if record !== null && view.mode !== 'create' && view.capabilities?.update.allowed}
		<Button variant="outline" disabled={act.pending} onclick={() => start('facility_form_read')}
			>{t('app.forms.fill')}</Button
		>
	{/if}
	{#if record !== null}<Button
			variant="outline"
			disabled={act.pending}
			onclick={() => start('facility_form_pack')}>{t('app.forms.pack')}</Button
		>{/if}
	{#if run}<RunStatus
			{ctx}
			{automation}
			{run}
			download={automation === 'facility_form_pack'}
		/>{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="facility_form"
		{sections}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
	/>
{:else}
	<RecordShell
		{ctx}
		of="facility_form"
		{sections}
		id={record.id}
		subtitle={['vendor', 'pay_by_date']}
		{...record.read_note === null ? {} : { hint: record.read_note }}
		footer_actions={fill}
	/>
{/if}
