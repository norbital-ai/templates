<script lang="ts">
	/** A facility form: its fields and attachments (the generated form), and Fill from attachments in the footer. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, RecordShell, use_act, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'facility_form'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode === 'create' ? null : view.record);
	const act = use_act(ctx);
</script>

{#snippet fill()}
	{#if record !== null}
		<Button
			variant="outline"
			disabled={act.pending}
			onclick={() => act.run(ctx.run('facility_form_read', { form: [record.id] }))}
			>{t('app.forms.fill')}</Button
		>
	{/if}
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
