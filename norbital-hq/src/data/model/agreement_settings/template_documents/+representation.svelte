<script lang="ts">
	import type { RecordView, RecordSection } from '@norbital-ai/ui';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Form, RecordShell, Sheet } from '@norbital-ai/ui';
	import DocumentPaper from '../../../../lib/DocumentPaper.svelte';
	import { Scroll } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'template_documents'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode === 'create' ? null : view.record);
	const settings = ctx.query({ agreement_settings: { fields: ['provider_signature'], limit: 1 } });
	const signature = $derived(settings.current?.agreement_settings.rows[0]?.provider_signature);
	let revising = $state(false);
	const sections: readonly RecordSection[] = [
		{
			name: 'template',
			fields: [
				'title',
				'key',
				'kind',
				'commitment',
				'scope',
				'version',
				'required',
				'subject',
				'drafting_instructions'
			]
		},
		{ name: 'content', fields: ['body'] }
	];
</script>

{#snippet preview()}
	<Scroll name={t('templates.preview')} size="fill">
		{#if record}<DocumentPaper
				body={record.body}
				title={record.title}
				signature={signature ? ctx.file_url(signature) : undefined}
			/>{/if}
	</Scroll>
{/snippet}
{#snippet actions()}
	{#if record && ctx.actor?.kind === 'member' && ctx.actor.admin}<Button
			variant="outline"
			onclick={() => (revising = true)}>{t('templates.revise')}</Button
		>{/if}
{/snippet}
<RecordShell
	{ctx}
	of="template_documents"
	{...view.mode === 'create'
		? { mode: 'create' as const, values: view.values }
		: { id: view.record.id }}
	fields={view.mode === 'create'
		? [
				'title',
				'key',
				'kind',
				'commitment',
				'scope',
				'required',
				'subject',
				'drafting_instructions',
				'body'
			]
		: [
				'title',
				'key',
				'kind',
				'commitment',
				'scope',
				'version',
				'required',
				'subject',
				'drafting_instructions'
			]}
	{sections}
	{actions}
	tabs={record === null
		? []
		: [{ name: 'preview', title: t('templates.preview'), icon: 'lucide:file-text', body: preview }]}
/>
<Sheet
	open={revising}
	on_open_change={(open) => !open && (revising = false)}
	title={t('templates.revise')}
>
	{#if record && revising}
		<Form
			{ctx}
			of={{ automation: 'template_documents_new_version' }}
			values={{
				template_documents: [record.id],
				title: record.title,
				body: record.body,
				...(record.subject == null ? {} : { subject: record.subject }),
				...(record.required == null ? {} : { required: record.required }),
				...(record.drafting_instructions == null
					? {}
					: { drafting_instructions: record.drafting_instructions })
			}}
			fields={['title', 'subject', 'drafting_instructions', 'required', 'body']}
			on_outcome={(outcome) => {
				if (outcome.kind === 'committed') revising = false;
			}}
		/>
	{/if}
</Sheet>
