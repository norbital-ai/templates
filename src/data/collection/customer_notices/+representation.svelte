<script lang="ts">
	/** A notice sent to a customer: what it said and about which visit stay open; its delivery trail folds away. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell } from '@norbital-ai/ui';
	import { when } from '../../../lib/summary.js';

	let { view }: { view: RecordView<'customer_notices'> } = $props();
	const t = bolt.t;
	const sections: RecordSection[] = [
		{
			name: 'notice',
			title: t('models.customer_notices.singular'),
			fields: ['subject', 'customer', 'visit', 'body']
		},
		{
			name: 'delivery',
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
			defaultOpen: false,
			summary: (r) =>
				r.sent_at == null
					? t('summary.not_sent')
					: t('summary.sent', { at: when(String(r.sent_at)) })
		}
	];
</script>

{#if view.mode === 'update'}
	<RecordShell of="customer_notices" id={view.record.id} {sections} />
{:else}
	<RecordShell of="customer_notices" mode="create" values={view.values} {sections} />
{/if}
