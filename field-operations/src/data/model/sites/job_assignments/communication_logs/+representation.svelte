<script lang="ts">
	/** A received message: read-only; messages are filed by the WhatsApp envoy, never typed here. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { type RecordView, EmptyState, format, RecordShell } from '@norbital-ai/ui';
	import { senderName } from '../../../../../lib/dispatch.js';
	let {
		ctx,
		view
	}: {
		ctx: PageContext;
		view: RecordView<'communication_logs'>;
	} = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	/** Who sent it, by name; a reader without members sees none. */
	const members = ctx.query({ sys_user: { fields: ['name', 'email', 'phone'], limit: 1000 } });
	const from = $derived(
		record == null ? '—' : (senderName(record.sender, members.current?.sys_user.rows ?? []) ?? '—')
	);
</script>

{#if record == null}
	<EmptyState title={ctx.t('component.communication_recorded_automatically')} />
{:else}
	<RecordShell
		of="communication_logs"
		id={record.id}
		subtitle={`${from} · ${format({ kind: 'instant' }, record.sent_at, {
			locale: ctx.locale,
			zone: ctx.tz
		})}`}
		fields={['message', 'sent_at', 'job_assignment_id']}
		sections={[
			{
				name: 'message',
				icon: 'lucide:message-square',
				title: ctx.t('section.message'),
				fields: ['message', 'sent_at', 'job_assignment_id']
			}
		]}
	/>
{/if}
