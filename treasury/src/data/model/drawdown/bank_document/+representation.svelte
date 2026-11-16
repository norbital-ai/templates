<script lang="ts">
	/**
	 * One advice: its fields and the figures read from it (edit any the PDF shows differently, then Save), the
	 * workspace's own arithmetic on those figures, and native approval controls.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Button,
		Form,
		RecordShell,
		RunsFor,
		use_act,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { Scroll, Split, Stack } from '@norbital-ai/ui/layout';
	import { adviceChecks } from '../../../../lib/treasury.js';
	let { view, ctx }: { view: RecordView<'bank_document'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode === 'create' ? null : view.record);
	const sections: readonly RecordSection[] = [
		{ name: 'advice', fields: ['file', 'doc_type', 'bank', 'drawdown'] },
		{ name: 'figures', title: t('app.advices.figures'), fields: ['extracted'] },
		{
			name: 'details',
			title: t('app.advices.details'),
			default_open: false,
			fields: ['advice_reference', 'advice_date', 'notes']
		},
		{ name: 'reading', fields: ['read_status', 'read_note'] }
	];
	const line = $derived.by(() => {
		const id = record?.drawdown ?? null;
		return id === null
			? null
			: ctx.query({
					drawdown: {
						where: { id: { eq: id } },
						fields: ['day_count_basis'],
						facility: { fields: ['interest_rounding'] },
						limit: 1
					}
				});
	});
	const terms = $derived(line?.current?.drawdown.rows[0]);
	const checks = $derived(
		record?.extracted == null
			? []
			: adviceChecks(
					{
						principal: record.extracted.principal ?? null,
						interest_rate_pct: record.extracted.interest_rate_pct ?? null,
						interest_amount: record.extracted.interest_amount ?? null,
						interest_days: record.extracted.interest_days ?? null,
						start_date: record.extracted.start_date ?? null,
						due_date: record.extracted.due_date ?? null,
						total_debited: record.extracted.total_debited ?? null,
						charges: record.extracted.charges ?? []
					},
					terms?.day_count_basis ?? 'actual_360',
					terms?.facility?.interest_rounding ?? 'nearest_cent'
				)
	);
	const subject = $derived(record?.id ?? null);
	const runWhere = $derived(subject === null ? {} : { input: { eq: { advice: [subject] } } });
	const act = use_act(ctx);
	const retry = () => {
		if (record === null) return;
		if (record.read_status === 'uploaded') {
			act.run(ctx.run('bank_document_read', { advice: [record.id] }));
			return;
		}
		act.run(
			ctx.act({
				'bank_document.update': [
					{ target: record, set: { read_status: 'uploaded', read_note: null } }
				]
			})
		);
	};
</script>

{#snippet arithmetic()}
	<Stack gap="sm">
		{#if checks.length === 0}<p class="text-meta">{t('app.advices.no_checks')}</p>{/if}
		{#each checks as c (c.key)}
			<Alert.Root variant={c.ok ? 'default' : 'warning'}>
				<Alert.Description>{c.ok ? '✓' : '▲'} {t(c.key, c.values)}</Alert.Description>
			</Alert.Root>
		{/each}
	</Stack>
{/snippet}

{#snippet next()}
	{#if record !== null && view.mode !== 'create' && view.capabilities?.update.allowed && ['uploaded', 'checked', 'failed'].includes(record.read_status)}
		<Button variant="ghost" disabled={act.pending} onclick={retry}>{t('app.advices.reread')}</Button
		>
	{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="bank_document"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
		footer={t('app.advices.upload_hint')}
	/>
{:else}
	<RecordShell
		{ctx}
		of="bank_document"
		id={record.id}
		subtitle={['doc_type', 'advice_date']}
		footer={t(
			record.read_status === 'uploaded'
				? 'app.advices.read_hint'
				: record.drawdown === null
					? 'app.advices.link_hint'
					: 'app.advices.review_hint'
		)}
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
					switch_labels={[t('app.advices.original'), t('app.advices.figures')]}
				>
					{#snippet start()}
						{@const pdf = ctx.ui.kinds.file_url?.(shown.record.file)}
						{#if pdf !== undefined}<iframe
								src={`${pdf}#view=FitH`}
								title={t('app.advices.original')}
								class="h-full min-h-80 w-full border-0 bg-background"
							/>{/if}
					{/snippet}
					{#snippet end()}
						<Scroll name={t('app.advices.figures')} size="fill">
							<Stack gap="md">
								<Form
									{ctx}
									of="bank_document"
									id={shown.record.id}
									record={shown.record}
									mode={shown.mode === 'view' ? 'view' : 'update'}
									fields={[
										'file',
										'doc_type',
										'bank',
										'drawdown',
										'extracted',
										'advice_reference',
										'advice_date',
										'notes',
										'read_note'
									]}
									{sections}
								/>
								{@render arithmetic()}
								<RunsFor
									{ctx}
									automation="bank_document_read"
									limit={20}
									where={runWhere}
								/>
								<RunsFor
									{ctx}
									automation="bank_document_apply"
									limit={20}
									where={runWhere}
								/>
							</Stack>
						</Scroll>
					{/snippet}
				</Split>
			{/if}
		{/snippet}
	</RecordShell>
{/if}
