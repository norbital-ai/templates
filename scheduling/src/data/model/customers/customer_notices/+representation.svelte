<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { type RecordSection, type RecordView, format, RecordShell } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'customer_notices'>; ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const scopedCustomer = $derived(
		record !== null || (view.mode === 'create' && view.values.customer != null)
	);
	const scopedAppointment = $derived(
		record !== null || (view.mode === 'create' && view.values.appointment != null)
	);

	const noticeFields = $derived<readonly ('subject' | 'customer' | 'appointment' | 'body')[]>([
		'subject',
		...(scopedCustomer ? ([] as const) : (['customer'] as const)),
		...(scopedAppointment ? ([] as const) : (['appointment'] as const)),
		'body'
	]);

	const deliveryFields = [
		'whatsapp',
		'to_address',
		'delivery',
		'delivery_reason',
		'sent_at',
		'delivered_at',
		'delivery_presumed',
		'opened_at',
		'replied_at',
		'reply_excerpt',
		'auto_replied_at'
	] as const;

	const storedFields = $derived([...noticeFields, ...deliveryFields]);

	const sections = $derived<RecordSection[]>([
		{
			name: 'notice',
			icon: 'lucide:file-text',
			title: t('models.customer_notices.singular'),
			fields: [...noticeFields]
		},
		...(record === null
			? []
			: [
					{
						name: 'delivery',
						icon: 'lucide:send',
						title: t('section.delivery'),
						fields: [...deliveryFields],
						default_open: false,
						summary: (r: Record<string, unknown>) =>
							r.sent_at == null
								? t('summary.not_sent')
								: t('summary.sent', {
										at: format({ kind: 'instant' }, String(r.sent_at), {
											locale: ctx.locale,
											zone: ctx.tz
										})
									})
					}
				])
	]);
</script>

{#if record !== null}
	<RecordShell
		{ctx}
		of="customer_notices"
		id={record.id}
		title={record.subject}
		fields={storedFields}
		{sections}
	/>
{:else}
	<RecordShell
		{ctx}
		of="customer_notices"
		fields={noticeFields}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{/if}
