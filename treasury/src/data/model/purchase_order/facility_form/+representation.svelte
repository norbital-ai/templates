<script lang="ts">
	/** A facility form: its fields and attachments (the generated form), and Fill from attachments in the footer. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, RecordShell, RunStatus, use_act, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'facility_form'>; ctx: PageContext } = $props();
	const t = ctx.t;
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
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
	/>
{:else}
	<RecordShell
		{ctx}
		of="facility_form"
		id={record.id}
		subtitle={['vendor', 'pay_by_date']}
		{...record.read_note === null ? {} : { hint: record.read_note }}
		footer_actions={fill}
	/>
{/if}
