<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	/** A notice sent to a customer: what it said and about which visit stay open; its delivery trail folds away. */
	import { type RecordSection, type RecordView, format, RecordShell } from '@norbital-ai/ui';
	let {
		view,
		ctx
	}: {
		view: RecordView<'customer_notices'>;
		ctx: PageContext;
	} = $props();
	const t = ctx.t;
	const sections: RecordSection[] = [
		{
			name: 'notice',
			icon: 'lucide:file-text',
			title: t('models.customer_notices.singular'),
			fields: ['subject', 'customer', 'visit', 'body']
		},
		{
			name: 'delivery',
			icon: 'lucide:send',
			title: t('section.delivery'),
			fields: [
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
			],
			default_open: false,
			summary: (r) =>
				r.sent_at == null
					? t('summary.not_sent')
					: t('summary.sent', {
							at: format({ kind: 'instant' }, String(r.sent_at), {
								locale: ctx.locale,
								zone: ctx.tz
							})
						})
		}
	];
</script>

{#if view.mode !== 'create'}
	<RecordShell {ctx} of="customer_notices" id={view.record.id} {sections} />
{:else}
	<RecordShell {ctx} of="customer_notices" mode="create" values={view.values} {sections} />
{/if}
