<script lang="ts">
	/**
	 * Facility forms: one per PO paid by T/T advance or LC. New starts a form; attach the PO, proforma and customer PO,
	 * fill it from them, check it, add the pay-by date, and print it with its attachments for signature.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:file-signature"
	title={t('app.forms.title')}
	description={t('app.forms.description')}
>
	<Table
		{ctx}
		of="facility_form"
		order_by={{ created_at: 'desc' }}
		columns={[
			'po_number',
			'vendor',
			'facility_required',
			'currency',
			'amount',
			'pay_by_date',
			'purchase_order'
		]}
		toolbar={{ title: t('app.forms.title') }}
	/>
</AppShell>
