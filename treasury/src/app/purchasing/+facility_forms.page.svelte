<script lang="ts">
	/**
	 * Facility forms: one per PO paid by T/T advance or LC. New asks only for the PO, proforma and customer PO, which
	 * fill the form as they land; check it, add the pay-by date, and print it with its attachments for signature.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, format } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

{#snippet moneyCell({
	row,
	value
}: {
	row: { readonly currency: string | null };
	value: string | null | undefined;
})}
	{value == null
		? '—'
		: format({ kind: 'money' }, value, {
				locale: ctx.locale,
				...(row.currency ? { currency: row.currency } : {})
			})}
{/snippet}

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
			{
				field: 'amount',
				kind: { kind: 'money', currency: 'currency' },
				align: 'end',
				cell: moneyCell
			},
			'pay_by_date',
			'purchase_order'
		]}
		toolbar={{
			title: false,
			actions: [
				{
					icon: 'lucide:file-down',
					name: t('app.forms.pack'),
					requires_selection: true,
					disabled: (ids) => (ids.length === 1 ? null : t('errors.one_form')),
					run: (ids) => ctx.run('facility_form_pack', { form: [...ids] })
				}
			]
		}}
	/>
</AppShell>
