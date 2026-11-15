<script lang="ts">
	/**
	 * One advice: its fields and the figures read from it (edit any the PDF shows differently, then Save), the
	 * workspace's own arithmetic on those figures, and Read / Apply in the footer.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Button, RecordShell, use_act, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { adviceChecks } from '../../../../lib/treasury.js';
	let { view, ctx }: { view: RecordView<'bank_document'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const record = $derived(view.mode === 'create' ? null : view.record);
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
	const act = use_act(ctx);
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
	{#if record !== null && record.read_status !== 'applied'}
		<Button
			variant="outline"
			disabled={act.pending}
			onclick={() => act.run(ctx.run('bank_document_read', { advice: [record.id] }))}
			>{t('app.advices.read')}</Button
		>
		<Button
			variant="outline"
			disabled={act.pending || record.extracted === null || record.drawdown === null}
			onclick={() => act.run(ctx.run('bank_document_apply', { advice: [record.id] }))}
			>{t('app.advices.apply')}</Button
		>
	{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="bank_document"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
	/>
{:else}
	<RecordShell
		{ctx}
		of="bank_document"
		id={record.id}
		subtitle={['doc_type', 'advice_date']}
		footer_actions={next}
		tabs={[
			{
				name: 'checks',
				title: t('app.advices.checks'),
				icon: 'lucide:calculator',
				body: arithmetic
			}
		]}
	/>
{/if}
