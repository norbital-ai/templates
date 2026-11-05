<script lang="ts">
	import { bolt } from '$bolt';
	import { Schema } from 'effect';
	import type { Value } from '@norbital-ai/std/kind';
	import { formatValue, RecordShell, type RecordView } from '@norbital-ai/ui';
	import {
		emptyPayslipBreakdown,
		PayslipBreakdown
	} from '../../../../lib/payroll_engine/payslip_breakdown.js';

	let { view }: { view: RecordView<'payslip'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const breakdown = $derived.by(() => {
		if (record === null) return emptyPayslipBreakdown;
		try {
			return Schema.decodeUnknownSync(PayslipBreakdown)(record.breakdown);
		} catch {
			return emptyPayslipBreakdown;
		}
	});
	const numberValue = (value: Value | undefined): number | null => {
		if (typeof value === 'number') return Number.isFinite(value) ? value : null;
		if (typeof value === 'string') {
			const number = Number(value);
			return Number.isFinite(number) ? number : null;
		}
		if (value !== null && typeof value === 'object') {
			const decimal = Reflect.get(value, '$dec');
			if (typeof decimal === 'string' && Number.isFinite(Number(decimal))) return Number(decimal);
			const text = String(value);
			if (text !== '[object Object]' && Number.isFinite(Number(text))) return Number(text);
		}
		return null;
	};
	const money = (value: Value | undefined) => {
		const number = numberValue(value);
		return number === null
			? formatValue(value, bolt.locale)
			: new Intl.NumberFormat(bolt.locale, { maximumFractionDigits: 2 }).format(number);
	};
	const earnings = $derived(
		breakdown.lines.filter((line) => line.party === 'EMPLOYEE' && line.direction === 'ADD')
	);
	const deductions = $derived(
		breakdown.lines.filter((line) => line.party === 'EMPLOYEE' && line.direction === 'DEDUCT')
	);
	const employer = $derived(breakdown.lines.filter((line) => line.party === 'EMPLOYER'));
</script>

{#snippet list(title: string, lines: typeof breakdown.lines)}
	{#if lines.length > 0}<section>
			<h3 class="text-xs font-medium text-muted-foreground">{title}</h3>
			<ul class="mt-1 divide-y">
				{#each lines as line (line.code + line.subtotal_id + line.amount)}
					<li class="flex items-center justify-between gap-3 py-1.5 text-sm">
						<span class="truncate">{line.label}</span>
						<span class="shrink-0 tabular-nums">{money(line.amount)}</span>
					</li>
				{/each}
			</ul>
		</section>{/if}
{/snippet}
<RecordShell
	of="payslip"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record !== null}<div class="grid gap-4">
			<section class="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
				<div>
					<p class="text-xs text-muted-foreground">Net pay</p>
					<p class="text-2xl font-semibold tabular-nums">{money(record.net_pay)}</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Gross earnings</p>
					<p class="text-lg font-medium tabular-nums">{money(record.gross_earnings ?? 0)}</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Total deductions</p>
					<p class="text-lg font-medium tabular-nums">{money(record.total_deductions)}</p>
				</div>
			</section>
			{@render list(bolt.t('app.payroll.earnings'), earnings)}
			{@render list(bolt.t('app.payroll.deductions'), deductions)}
			{@render list(bolt.t('app.payroll.employer_contributions'), employer)}
		</div>
	{/if}
</RecordShell>
