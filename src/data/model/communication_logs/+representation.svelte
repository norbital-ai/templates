<script lang="ts">
	/** A received message: read-only; messages are filed by the WhatsApp envoy, never typed here. */
	import { bolt } from '$bolt';
	import { type RecordView, EmptyState, format, RecordShell, useKinds } from '@norbital-ai/ui';
	import { senderName } from '../../../lib/dispatch.js';
	let {
		view
	}: {
		view: RecordView<'communication_logs'>;
	} = $props();
	const kinds = useKinds();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	/** Who sent it, by name; a reader without members sees none. */
	const members = bolt.query({ sys_user: { fields: ['name', 'email', 'phone'], limit: 1000 } });
	const from = $derived(
		record == null ? '—' : (senderName(record.sender, members.current?.sys_user.rows ?? []) ?? '—')
	);
</script>

{#if record == null}
	<EmptyState title={bolt.t('component.communication_recorded_automatically')} />
{:else}
	<RecordShell
		of="communication_logs"
		id={record.id}
		subtitle={`${from} · ${format({ kind: 'instant' }, record.sent_at, {
			locale: kinds.locale ?? bolt.locale,
			...(kinds.zone == null ? {} : { zone: kinds.zone })
		})}`}
		fields={['message', 'sent_at', 'job_assignment_id']}
		sections={[
			{
				name: 'message',
				title: bolt.t('section.message'),
				fields: ['message']
			},
			{
				name: 'delivery',
				title: bolt.t('section.delivery'),
				fields: ['sent_at', 'job_assignment_id'],
				defaultOpen: false,
				summary: () => from
			}
		]}
	/>
{/if}
