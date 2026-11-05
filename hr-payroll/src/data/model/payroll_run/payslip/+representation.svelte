<script lang="ts">
	import { bolt } from '$bolt';
	import { Schema } from 'effect';
	import type { Value } from '@norbital-ai/std/kind';
	import {
		Accordion,
		Form,
		Icon,
		formatValue,
		RecordShell,
		type RecordView
	} from '@norbital-ai/ui';
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
	let open = $state<string[]>([]);
	$effect(() => {
		if (open.length === 0 && breakdown.checkpoints.length > 0)
			open = [breakdown.checkpoints[0]!.id];
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
	const linesAt = (id: string, code: string) =>
		breakdown.lines.filter(
			(line) =>
				line.subtotal_id === id &&
				line.code !== code &&
				line.party === 'EMPLOYEE' &&
				line.source !== 'statutory_contribution_catalog'
		);
</script>

<RecordShell
	of="payslip"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if view.mode === 'edit' && record !== null}<Form
			of="payslip"
			mode="update"
			id={record.id}
			{record}
			fields={['state']}
		/>{:else if record !== null}<div class="grid gap-4">
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
				<p class="text-xs text-muted-foreground sm:col-span-3">
					Read-only calculated snapshot. {record.period ?? ''} · {record.state}
				</p>
			</section>

			{#if breakdown.checkpoints.length === 0}
				<p class="text-sm text-muted-foreground">
					This payslip predates the stored breakdown; totals remain authoritative.
				</p>
			{:else}<Accordion.Root type="multiple" bind:value={open} class="w-full">
					{#each breakdown.checkpoints as node, index (node.id)}
						{@const previous = index === 0 ? 0 : breakdown.checkpoints[index - 1]!.value}
						{@const delta = node.value - previous}
						<Accordion.Item value={node.id}>
							<Accordion.Trigger>
								<span class="flex w-full items-center justify-between gap-3">
									<span class="flex min-w-0 items-center gap-2">
										<span class="font-mono text-[11px] text-muted-foreground">{node.code}</span>
										<span class="truncate text-sm font-medium">{node.name}</span>
									</span>
									<span class="flex shrink-0 items-baseline gap-2 tabular-nums">
										<span class="text-[10px] text-muted-foreground"
											>running {money(node.value)}</span
										>
										<span class={delta < 0 ? 'text-sm text-destructive' : 'text-sm'}>
											{delta > 0 ? '+' : ''}{money(delta)}
										</span>
									</span>
								</span>
							</Accordion.Trigger>
							<Accordion.Content>
								{#if linesAt(node.id, node.code).length > 0}<ul class="divide-y">
										{#each linesAt(node.id, node.code) as line (line.code + line.subtotal_id + line.amount)}
											<li class="flex items-center justify-between gap-3 py-1 text-sm">
												<span class="flex min-w-0 items-center gap-2">
													<span class="font-mono text-[11px] text-muted-foreground"
														>{line.code}</span
													>
													<span class="truncate">{line.label}</span>
													<span
														role="img"
														title={`${line.source}${line.quantity == null ? '' : ` · ${line.quantity}${line.unit == null ? '' : ` ${line.unit}`}`} · ${line.party.toLowerCase()} · ${line.direction.toLowerCase()}`}
														aria-label="Calculation details"
														class="text-muted-foreground"
														><Icon name="lucide:info" class="size-3" /></span
													>
												</span>
												<span class="shrink-0 tabular-nums">
													{line.direction === 'DEDUCT' ? '−' : '+'}{money(line.amount)}
												</span>
											</li>
										{/each}
									</ul>
								{:else}<p class="py-1 text-xs text-muted-foreground">
										{node.code === 'BASIC'
											? 'Base salary is the checkpoint value.'
											: 'No separate pay lines.'}
									</p>{/if}
							</Accordion.Content>
						</Accordion.Item>
					{/each}
				</Accordion.Root>
			{/if}

			{#if breakdown.statutory.length > 0}<section class="rounded-lg border p-3">
					<h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Statutory
					</h3>
					<ul class="mt-2 divide-y">
						{#each breakdown.statutory as scheme (scheme.code)}
							<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1 text-sm">
								<span class="flex items-center gap-2">
									<span class="font-mono text-[11px] text-muted-foreground">{scheme.code}</span>
									<span>{scheme.kind}</span>
									<span
										role="img"
										title={`statutory contribution · employee ${money(scheme.employee)}`}
										aria-label="Calculation details"
										class="text-muted-foreground"><Icon name="lucide:info" class="size-3" /></span
									>
								</span>
								<span class="tabular-nums">{money(scheme.employee)}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	{/if}
</RecordShell>
