<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Schema } from 'effect';
	import { format, Icon, RecordShell, Tooltip, type RecordView } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		emptyPayslipBreakdown,
		PayslipBreakdown
	} from '../../../../lib/payroll_engine/payslip_breakdown.js';
	import { pageLaws } from '../../../../lib/ui/law.svelte.js';

	const FAMILIES = [
		'allowance_catalog',
		'leave_catalog',
		'claim_catalog',
		'adhoc_catalog',
		'loan_catalog',
		'overtime_catalog',
		'statutory_contribution_catalog'
	] as const;

	let { view, ctx }: { view: RecordView<'payslip'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const breakdown = $derived.by(() => {
		if (record === null) return emptyPayslipBreakdown;
		try {
			return Schema.decodeUnknownSync(PayslipBreakdown)(record.breakdown);
		} catch {
			return emptyPayslipBreakdown;
		}
	});
	// the period's own lines; what the payslip carries for earlier periods is shown apart, by the period it belongs to
	const own = $derived(breakdown.lines.filter((line) => line.period === undefined));
	const earnings = $derived(
		own.filter((line) => line.party === 'EMPLOYEE' && line.direction === 'ADD')
	);
	const deductions = $derived(
		own.filter((line) => line.party === 'EMPLOYEE' && line.direction === 'DEDUCT')
	);
	const employer = $derived(own.filter((line) => line.party === 'EMPLOYER'));
	const adjustments = $derived(
		[
			...Map.groupBy(
				breakdown.lines.filter((line) => line.period !== undefined),
				(line) => String(line.period)
			)
		].toSorted(([one], [other]) => one.localeCompare(other))
	);

	// What each line is, in the words of the catalogue row that posted it, under the law of the payslip's company on
	// its run's pay date.
	const owner = $derived(
		record === null
			? null
			: ctx.query({
					payslip: {
						where: { id: { eq: record.id } },
						fields: ['entity_id', 'payroll_run_id'],
						limit: 1,
						entity_id: { fields: ['settings_code'] },
						payroll_run_id: { fields: ['pay_date'] }
					}
				})
	);
	const slip = $derived(owner?.current?.payslip.rows[0]);
	const laws = pageLaws(ctx, () => (slip?.entity_id == null ? [] : [slip.entity_id.settings_code]));
	const law = $derived(
		slip?.entity_id == null || slip.payroll_run_id == null
			? undefined
			: laws.on(slip.entity_id.settings_code, String(slip.payroll_run_id.pay_date))
	);
	const descriptions = $derived(
		new Map<string, string>(
			FAMILIES.flatMap((family) =>
				(law?.rows[family] ?? []).flatMap((row) =>
					typeof row.description === 'string' && row.description.trim() !== ''
						? [[`${family}:${String(row.code)}`, row.description] as const]
						: []
				)
			)
		)
	);
	/**
	 * A line's catalogue family: an entry (or a loan repayment) belongs to the catalogue it was raised on; a scheme's
	 * employer share is `<code>_EMPLOYER`.
	 */
	const describe = (line: (typeof breakdown.lines)[number]) =>
		descriptions.get(
			`${line.source.replace(/_entry(_repayment)?$/, '')}:${line.party === 'EMPLOYER' ? line.code.replace(/_EMPLOYER$/, '') : line.code}`
		);
	const money = (value: Parameters<typeof format>[1]) =>
		format({ kind: 'money' }, value, { locale: ctx.locale });
	const measure = (line: (typeof breakdown.lines)[number]) =>
		line.quantity === undefined || line.unit === undefined || line.unit === 'MONEY'
			? ''
			: `${new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 4 }).format(line.quantity)} ${line.unit.toLowerCase()}`;
</script>

<!-- one balance-sheet row: its label, an info marker holding the description, the value flush right -->
{#snippet row(label: string, hint: string | undefined, value: string, note = '', total = false)}
	<Inline
		as="li"
		justify="between"
		gap="md"
		class={total ? 'py-1 text-sm font-medium' : 'py-1 text-sm'}
	>
		<Inline gap="xs">
			<span class={total ? undefined : 'font-mono'}>{label}</span>
			{#if hint !== undefined}<Tooltip text={hint}>
					{#snippet trigger({ props })}
						<button
							{...props}
							type="button"
							aria-label={hint}
							class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
							><Icon name="lucide:info" class="size-3.5" /></button
						>
					{/snippet}
				</Tooltip>{/if}
			{#if note !== ''}<span class="text-xs text-muted-foreground">{note}</span>{/if}
		</Inline>
		<span class="tabular-nums">{value}</span>
	</Inline>
{/snippet}
{#snippet list(
	title: string,
	lines: typeof breakdown.lines,
	total: string,
	sum: Parameters<typeof format>[1]
)}
	{#if lines.length > 0}<Stack as="section" gap="xs">
			<h3 class="text-xs font-medium text-muted-foreground">{title}</h3>
			<Stack as="ul" gap="none" divided>
				{#each lines as line (line.code + line.subtotal + line.amount)}
					{@render row(line.code, describe(line), money(line.amount), measure(line))}
				{/each}
				{@render row(total, undefined, money(sum), '', true)}
			</Stack>
		</Stack>{/if}
{/snippet}
<RecordShell
	{ctx}
	of="payslip"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record !== null}<Stack gap="md">
			{@render list(
				ctx.t('app.payroll.earnings'),
				earnings,
				ctx.t('app.payroll.gross_earnings'),
				record.gross_earnings ?? 0
			)}
			{@render list(
				ctx.t('app.payroll.deductions'),
				deductions,
				ctx.t('app.payroll.total_deductions'),
				record.total_deductions
			)}
			<Stack as="ul" gap="none" class="border-y">
				{@render row(ctx.t('app.payroll.net_pay'), undefined, money(record.net_pay), '', true)}
			</Stack>
			{@render list(
				ctx.t('app.payroll.employer_contributions'),
				employer,
				ctx.t('app.payroll.employer_cost'),
				record.employer_cost
			)}
			{#if breakdown.checkpoints.length > 0}<Stack as="section" gap="xs">
					<h3 class="text-xs font-medium text-muted-foreground">
						{ctx.t('app.payroll.checkpoints')}
					</h3>
					<Stack as="ul" gap="none" divided>
						{#each breakdown.checkpoints as checkpoint (checkpoint.code)}
							{@render row(
								checkpoint.code,
								checkpoint.name.trim() === '' ? undefined : checkpoint.name,
								money(checkpoint.value)
							)}
						{/each}
					</Stack>
				</Stack>{/if}
			{#if adjustments.length > 0}<Stack as="section" gap="xs">
					<h3 class="text-xs font-medium text-muted-foreground">
						{ctx.t('app.payroll.adjustments')}
					</h3>
					<p class="text-xs text-muted-foreground">{ctx.t('app.payroll.adjustments_help')}</p>
					{#each adjustments as [period, lines] (period)}
						<h4 class="mt-2 text-xs font-medium tabular-nums">{period}</h4>
						<Stack as="ul" gap="none" divided>
							{#each lines as line (line.code + line.party)}
								{@render row(
									line.code,
									describe(line),
									`${line.direction === 'DEDUCT' ? '−' : '+'} ${money(line.amount)}`,
									line.party === 'EMPLOYER' ? ctx.t('app.payroll.adjustment_employer') : ''
								)}
							{/each}
						</Stack>
					{/each}
				</Stack>{/if}
		</Stack>
	{/if}
</RecordShell>
