<script lang="ts">
	/**
	 * One hedge document: uploading asks only for the file; the reader fills its kind, bank, reference and trade date
	 * and keeps it with its deal (or makes the deal to confirm). The PDF sits beside what was read.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Button,
		Form,
		RecordShell,
		Spinner,
		use_act,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { Scroll, Split, Stack } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'fx_document'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode === 'create' ? null : view.record);
	const upload: readonly RecordSection[] = [
		{ name: 'document', icon: 'lucide:file-text', title: t('fx.document'), fields: ['file'] }
	];
	const sections: readonly RecordSection[] = [
		{
			name: 'document',
			icon: 'lucide:file-text',
			title: t('fx.document'),
			fields: ['file', 'kind', 'bank', 'deal', 'bank_reference', 'trade_date', 'signed']
		},
		{
			name: 'reading',
			icon: 'lucide:scan-text',
			title: t('fx.reading'),
			fields: ['extracted', 'read_status', 'read_note']
		}
	];
	const act = use_act(ctx);
	const retry = () => {
		if (record === null) return;
		act.run(
			ctx.act({
				'fx_document.update': [
					{ target: record, set: { read_status: 'uploaded', read_note: null } }
				]
			})
		);
	};
</script>

{#snippet next()}
	{#if record?.read_status === 'failed' && view.mode !== 'create' && view.capabilities?.update.allowed}
		<Button variant="ghost" disabled={act.pending} onclick={retry}>{t('app.advices.reread')}</Button
		>
	{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="fx_document"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		fields={['file']}
		sections={upload}
		footer={t('fx.upload_hint')}
	/>
{:else}
	<RecordShell
		{ctx}
		of="fx_document"
		id={record.id}
		subtitle={['kind', 'trade_date']}
		footer={t(record.read_status === 'checked' ? 'fx.unmatched_hint' : 'fx.document_hint')}
		footer_actions={next}
	>
		{#snippet children(shown)}
			{#if shown.mode !== 'create'}
				<Split
					ratio="half"
					collapse="switch"
					collapse_at="compact"
					size="fill"
					gap="md"
					switch_labels={[t('app.advices.original'), t('fx.reading')]}
				>
					{#snippet start()}
						{@const pdf = ctx.ui.kinds.file_url?.(shown.record.file)}
						{#if pdf !== undefined}<iframe
								src={`${pdf}#view=FitH`}
								title={t('app.advices.original')}
								class="h-full min-h-80 w-full border-0 bg-background"
							></iframe>{/if}
					{/snippet}
					{#snippet end()}
						<Scroll name={t('fx.reading')} size="fill">
							<Stack gap="md">
								{#if shown.record.read_status === 'uploaded'}
									<Alert.Root variant="default"
										><Alert.Description class="flex items-center gap-2"
											><Spinner class="size-3.5 shrink-0" /><span
												>{t('app.advices.reading_started')}</span
											></Alert.Description
										></Alert.Root
									>
								{/if}
								<Form
									{ctx}
									of="fx_document"
									id={shown.record.id}
									record={shown.record}
									mode={shown.mode === 'view' ? 'view' : 'update'}
									fields={[
										'file',
										'kind',
										'bank',
										'deal',
										'bank_reference',
										'trade_date',
										'signed',
										'extracted',
										'read_status',
										'read_note'
									]}
									{sections}
								/>
							</Stack>
						</Scroll>
					{/snippet}
				</Split>
			{/if}
		{/snippet}
	</RecordShell>
{/if}
