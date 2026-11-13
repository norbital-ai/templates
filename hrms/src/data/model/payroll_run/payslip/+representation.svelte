<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Schema } from 'effect';
	import { format, RecordShell, type RecordView } from '@norbital-ai/ui';
	import {
		emptyPayslipBreakdown,
		PayslipBreakdown
	} from '../../../../lib/payroll_engine/payslip_breakdown.js';

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

	// What each line is, in the words of the catalogue row that posted it under the payslip's own law version. An
	// employee reads five of the seven families; a family the reader cannot see leaves its lines by code.
	const inLaw = $derived(
		record === null
			? null
			: ({
					where: { settings_id: { eq: record.settings_id } },
					fields: ['code', 'description'],
					limit: 10000
				} as const)
	);
	const entryFamilies = $derived(
		inLaw === null
			? null
			: ctx.query({
					allowance_catalog: inLaw,
					leave_catalog: inLaw,
					claim_catalog: inLaw,
					adhoc_catalog: inLaw,
					loan_catalog: inLaw
				})
	);
	const lawFamilies = $derived(
		inLaw === null
			? null
			: ctx.query({ overtime_catalog: inLaw, statutory_contribution_catalog: inLaw })
	);
	const descriptions = $derived(
		new Map(
			Object.entries({ ...entryFamilies?.current, ...lawFamilies?.current }).flatMap(
				([family, page]) =>
					page.rows.flatMap((row) =>
						typeof row.description === 'string' && row.description.trim() !== ''
							? [[`${family}:${row.code}`, row.description] as const]
							: []
					)
			)
		)
	);
	/** A line's catalogue family: an entry (or a loan repayment) belongs to the catalogue it was raised on. */
	const describe = (line: (typeof breakdown.lines)[number]) =>
		descriptions.get(`${line.source.replace(/_entry(_repayment)?$/, '')}:${line.code}`);
	const measure = (line: (typeof breakdown.lines)[number]) =>
		line.quantity === undefined || line.unit === undefined || line.unit === 'MONEY'
			? ''
			: `${new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 4 }).format(line.quantity)} ${line.unit.toLowerCase()}`;
</script>

{#snippet list(title: string, lines: typeof breakdown.lines)}
	{#if lines.length > 0}<section>
			<h3 class="text-xs font-medium text-muted-foreground">{title}</h3>
			<ul class="mt-1 divide-y">
				{#each lines as line (line.code + line.subtotal_id + line.amount)}
					{@const description = describe(line)}
					<li class="flex items-start justify-between gap-3 py-1.5 text-sm">
						<span class="min-w-0">
							<span class="block">{description ?? line.label}</span>
							{#if description !== undefined || measure(line) !== ''}
								<span class="block text-xs text-muted-foreground">
									{#if description !== undefined}<span class="font-mono">{line.label}</span
										>{/if}{#if description !== undefined && measure(line) !== ''}
										·
									{/if}{measure(line)}
								</span>
							{/if}
						</span>
						<span class="shrink-0 tabular-nums"
							>{format({ kind: 'money' }, line.amount, { locale: ctx.locale })}</span
						>
					</li>
				{/each}
			</ul>
		</section>{/if}
{/snippet}
<RecordShell
	{ctx}
	of="payslip"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record !== null}<div class="grid gap-4">
			<section class="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
				<div>
					<p class="text-xs text-muted-foreground">Net pay</p>
					<p class="text-2xl font-semibold tabular-nums">
						{format({ kind: 'money' }, record.net_pay, { locale: ctx.locale })}
					</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Gross earnings</p>
					<p class="text-lg font-medium tabular-nums">
						{format({ kind: 'money' }, record.gross_earnings ?? 0, { locale: ctx.locale })}
					</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Total deductions</p>
					<p class="text-lg font-medium tabular-nums">
						{format({ kind: 'money' }, record.total_deductions, { locale: ctx.locale })}
					</p>
				</div>
			</section>
			{@render list(ctx.t('app.payroll.earnings'), earnings)}
			{@render list(ctx.t('app.payroll.deductions'), deductions)}
			{@render list(ctx.t('app.payroll.employer_contributions'), employer)}
			{#if adjustments.length > 0}<section>
					<h3 class="text-xs font-medium text-muted-foreground">
						{ctx.t('app.payroll.adjustments')}
					</h3>
					<p class="mt-1 text-xs text-muted-foreground">{ctx.t('app.payroll.adjustments_help')}</p>
					{#each adjustments as [period, lines] (period)}
						<h4 class="mt-3 text-xs font-medium tabular-nums">{period}</h4>
						<ul class="mt-1 divide-y">
							{#each lines as line (line.code + line.party)}
								{@const description = describe(line)}
								<li class="flex items-start justify-between gap-3 py-1.5 text-sm">
									<span class="min-w-0">
										<span class="block">{description ?? line.label}</span>
										{#if line.party === 'EMPLOYER'}<span class="block text-xs text-muted-foreground"
												>{ctx.t('app.payroll.adjustment_employer')}</span
											>{/if}
									</span>
									<span class="shrink-0 tabular-nums"
										>{line.direction === 'DEDUCT' ? '−' : '+'}
										{format({ kind: 'money' }, line.amount, { locale: ctx.locale })}</span
									>
								</li>
							{/each}
						</ul>
					{/each}
				</section>{/if}
		</div>
	{/if}
</RecordShell>
