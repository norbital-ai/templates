<script lang="ts">
	/**
	 * One person's settlement, in its two deliberately separate halves.
	 *
	 * OUTPUTS: BASE, PRORATION and STATUTORY are columns on this record — they are caused by no
	 * input, which is exactly why they are inlined — so they are read straight off `record` and need
	 * no table. ADJUSTMENTS is the one output relation: a row exists there only when exactly one
	 * captured input caused it.
	 *
	 * INPUTS are the source rows pinned to this slip — work days, component entries, leave entries,
	 * loan repayments — each through its own `payslip_id`. They are read beside the adjustments so
	 * the payslip answers "what was read" as directly as it answers "what was calculated".
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { schemeLabel } from '../../lib/payroll/scheme-label.js';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { Button } from '@norbital-ai/ui/button';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import {
		Accordion,
		AccordionContent,
		AccordionItem,
		AccordionTrigger
	} from '@norbital-ai/ui/accordion';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { HoverCard, HoverCardContent, HoverCardTrigger } from '@norbital-ai/ui/hover-card';
	import { Result, Schema } from 'effect';
	import { decodeNumber } from '@norbital-ai/std/json';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const payslipSummarySchema = Schema.Struct({
		payslip_employment: Schema.optional(
			Schema.NullOr(
				Schema.Struct({
					employee_number: Schema.optional(Schema.NullOr(Schema.String)),
					employment_employee: Schema.optional(
						Schema.NullOr(Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) }))
					)
				})
			)
		)
	});
	type PayslipSummary = Schema.Schema.Type<typeof payslipSummarySchema>;

	const decodePayslipSummary = Schema.decodeUnknownResult(payslipSummarySchema);

	const summaryQuery = $derived(
		record == null
			? null
			: client.db.payslips.findFirst({
					where: { id: { eq: record.id } },
					columns: { id: true },
					with: {
						payslip_employment: {
							columns: { id: true, employee_number: true },
							with: { employment_employee: { columns: { id: true, name: true } } }
						}
					}
				})
	);
	const summary = $derived.by((): PayslipSummary | null => {
		const current = summaryQuery?.current;
		if (current == null) return null;
		const parsed = decodePayslipSummary(current);
		return Result.isSuccess(parsed) ? parsed.success : null;
	});
	const employment = $derived(summary?.payslip_employment ?? null);

	/**
	 * The outputs, read straight off the record.
	 *
	 * Base, proration and statutory are frozen facts that name their source by code and key, so the
	 * screen prints what the row already says and resolves nothing. The catalogue link a screen
	 * needs is not there by design — a settled payslip does not become wrong when a component is
	 * archived.
	 *
	 * Each list is keyed by that name plus its index. The engine can write two base lines under one
	 * catalogue code (derived arrears plus a keyed entry) and two proration segments that share
	 * `term_key` and `from`. Keying on the name alone throws `each_key_duplicate` and leaves the
	 * detail pane on "Loading record…".
	 */
	const base = $derived(record?.base ?? []);
	const proration = $derived(record?.proration ?? []);
	const statutory = $derived(record?.statutory ?? []);

	/**
	 * How each statutory charge was derived, read from the run's frozen `calculation_trace`. The
	 * trace is stored once per run; this payslip's slice is the entry matching its employment, and
	 * each scheme's band, base lines and producer reads sit behind that scheme's info affordance.
	 */
	const traceQuery = $derived(
		record == null
			? null
			: client.db.payroll_runs.findFirst({
					where: { id: { eq: record.payroll_run_id } },
					columns: { calculation_trace: true }
				})
	);
	const schemeTrace = $derived.by(() => {
		type SchemeTrace = {
			readonly scheme_code: string;
			readonly rule_when: string | null;
			readonly base_amount: number;
			readonly employee_amount: number;
			readonly employer_amount: number;
			readonly inputs: readonly {
				readonly code: string;
				readonly label: string;
				readonly effect: 'INCLUDE' | 'REDUCE';
				readonly amount: number;
			}[];
			readonly reads: readonly {
				readonly code: string;
				readonly employee_amount: number;
				readonly employer_amount: number;
			}[];
		};
		const trace = traceQuery?.current?.calculation_trace;
		if (trace == null) return new Map<string, SchemeTrace>();
		const entry = trace.find((row) => row.employment_id === record?.employment_id);
		return new Map((entry?.schemes ?? []).map((scheme) => [scheme.scheme_code, scheme]));
	});
	/** A condition read top-down: every `&&`/`||` on its own line, so a band stops being one line. */
	const prettyRule = (rule: string | null | undefined): string =>
		(rule ?? '—').replaceAll(' && ', '\n&& ').replaceAll(' || ', '\n|| ');

	/** Repeated labels (twelve 1.5 overtime bands) read as one line: same class, one summed amount. */
	type TraceInput = {
		readonly code: string;
		readonly label: string;
		readonly effect: 'INCLUDE' | 'REDUCE';
		readonly amount: number;
	};
	const groupedInputs = (
		inputs: readonly TraceInput[]
	): ReadonlyArray<TraceInput & { readonly key: string }> => {
		type GroupedInput = {
			key: string;
			code: string;
			label: string;
			effect: 'INCLUDE' | 'REDUCE';
			amount: number;
		};
		const rows = new Map<string, GroupedInput>();
		for (const input of inputs) {
			const key = `${input.code}:${input.label}:${input.effect}`;
			const row = rows.get(key) ?? {
				key,
				code: input.code,
				label: input.label,
				effect: input.effect,
				amount: 0
			};
			row.amount += input.amount;
			rows.set(key, row);
		}
		return [...rows.values()];
	};

	/** The adjustments, in settlement order, keyed by their position for the list below. */
	const adjustments = $derived(
		(record?.adjustments ?? []).map((adjustment, index) => ({ ...adjustment, id: String(index) }))
	);

	type Adjustment = (typeof adjustments)[number];
	type AdjustmentGroup = {
		readonly key: string;
		readonly label: string;
		readonly inputKind: string;
		readonly bucket: string | null;
		readonly rate: unknown;
		readonly quantity: number;
		readonly amount: number;
		readonly entries: readonly Adjustment[];
	};

	/**
	 * One row per component: the same label, input kind, bucket and rate collapse into a summed
	 * line, and the individual entries — one per captured input — sit behind it. A component that
	 * occurred once is a plain row; there is nothing to unfold.
	 */
	const groupsFor = (rows: readonly Adjustment[]): AdjustmentGroup[] => {
		const groups = new Map<string, AdjustmentGroup>();
		for (const adjustment of rows) {
			const kind = inputKind(adjustment.family);
			const rate = adjustment.rate == null ? '' : String(adjustment.rate);
			const key = [adjustment.label, kind, adjustment.bucket ?? '', rate].join('\u0000');
			const current = groups.get(key);
			const quantity = decodeNumber(adjustment.quantity);
			const amount = decodeNumber(adjustment.amount);
			if (current === undefined) {
				groups.set(key, {
					key,
					label: adjustment.label,
					inputKind: kind,
					bucket: adjustment.bucket ?? null,
					rate: adjustment.rate,
					quantity: Number.isFinite(quantity) ? quantity : 0,
					amount: Number.isFinite(amount) ? amount : 0,
					entries: [adjustment]
				});
				continue;
			}
			groups.set(key, {
				...current,
				quantity: current.quantity + (Number.isFinite(quantity) ? quantity : 0),
				amount: current.amount + (Number.isFinite(amount) ? amount : 0),
				entries: [...current.entries, adjustment]
			});
		}
		return [...groups.values()];
	};

	/**
	 * The statement, in settlement order: earnings the contract and the inputs created, the unpaid
	 * time that reduced them, what was withheld, what was repaid, and what the employer owes on top.
	 * Every figure is read from the record, never recomputed: the ledger explains the settlement
	 * rather than re-deriving it, so a stored payslip always prints what it stored.
	 */
	const bucketRows = (bucket: Adjustment['bucket']) =>
		adjustments.filter((adjustment) => adjustment.bucket === bucket);
	const sumOf = (rows: readonly { readonly amount: unknown }[]) =>
		rows.reduce((total, row) => total + (decodeNumber(row.amount) || 0), 0);

	const earningsGroups = $derived(groupsFor(bucketRows('EARNING')));
	const absenceGroups = $derived(groupsFor(bucketRows('ABSENCE')));
	const deductionGroups = $derived(groupsFor(bucketRows('DEDUCTION')));
	const paymentGroups = $derived(groupsFor(bucketRows('NON_WAGE_PAYMENT')));
	const employerGroups = $derived(groupsFor(bucketRows('EMPLOYER_COST')));
	const informationGroups = $derived(groupsFor(bucketRows('INFORMATION')));

	const baseTotal = $derived(sumOf(base));
	const earningsTotal = $derived(baseTotal + sumOf(bucketRows('EARNING')));
	const unpaidTotal = $derived(sumOf(bucketRows('ABSENCE')));
	const withheldTotal = $derived(
		statutory.reduce((total, charge) => total + (decodeNumber(charge.employee_amount) || 0), 0)
	);
	const employerStatutoryTotal = $derived(
		statutory.reduce((total, charge) => total + (decodeNumber(charge.employer_amount) || 0), 0)
	);
	const deductionsTotal = $derived(sumOf(bucketRows('DEDUCTION')));
	const paymentsTotal = $derived(sumOf(bucketRows('NON_WAGE_PAYMENT')));
	const employerOtherTotal = $derived(sumOf(bucketRows('EMPLOYER_COST')));
	const employerCostTotal = $derived(
		employerStatutoryTotal + employerOtherTotal || decodeNumber(record?.employer_cost)
	);
	const gross = $derived(decodeNumber(record?.gross));
	const net = $derived(decodeNumber(record?.net));
	/** What the company actually pays out: the settlement plus every employer charge on top of it. */
	const companyCost = $derived(gross + employerCostTotal);
	/** Employee withholding and employer contributions are the money that reaches an authority. */
	const authoritiesTotal = $derived(withheldTotal + employerStatutoryTotal);
	/**
	 * A line as a reader adds it up: the ledger prints the signed effect on the employee, so an
	 * absence under earnings or a withholding under gross carries a minus and a refund carries a
	 * plus. The stored amounts are magnitudes; the direction is the bucket's, applied here once.
	 */
	const signedAmount = (amount: number, direction: 'add' | 'subtract'): string => {
		const value = direction === 'subtract' ? -amount : amount;
		const sign = value < 0 ? '−' : value > 0 ? '+' : '';
		return `${sign}${formatNumeric(Math.abs(value))}`;
	};

	function inputKind(family: Adjustment['family']): string {
		switch (family) {
			case 'CLAIM':
				return t('app.claims.title');
			case 'ADHOC':
				return t('app.adhoc.title');
			case 'WORK_DAY':
				return t('component.attendance');
			case 'LEAVE':
				return t('component.leave');
			case 'LOAN_REPAYMENT':
				return t('app.loans.agreements');
			default: {
				const _never: never = family;
				return _never;
			}
		}
	}
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/payslips-banner.svg"
	/>
</svelte:head>

{#snippet sectionInfo(label: string, description: string)}
	<Tooltip side="bottom" align="start" contentClass="max-w-80">
		{#snippet trigger({ props })}
			<Button {...props} variant="ghost" size="icon" aria-label={label}>
				<IconWrapper name="lucide:info" class="size-4" />
			</Button>
		{/snippet}
		{#snippet content()}
			<p class="text-xs leading-5">{description}</p>
		{/snippet}
	</Tooltip>
{/snippet}

{#snippet adjustmentRows(groups: readonly AdjustmentGroup[], direction: 'add' | 'subtract')}
	{#each groups as group (group.key)}
		{#if group.entries.length === 1}
			<div
				class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1 pl-4"
				data-adjustment-group={group.key}
			>
				<span class="min-w-0 truncate">
					{group.label}
					<span class="text-meta">· {group.inputKind}</span>
				</span>
				<span>{signedAmount(group.amount, direction)}</span>
			</div>
		{:else}
			<AccordionItem value={group.key} class="border-0" data-adjustment-group={group.key}>
				<AccordionTrigger
					class="group gap-2 py-1 pl-4 hover:no-underline [&>[data-slot=accordion-chevron]]:hidden"
				>
					<span class="flex min-w-0 flex-1 items-center gap-2 text-left font-normal">
						<!--
							The disclosure marker rides inside the label cell. A trailing chevron costs every
							accordion row grid width, so the numeric column ends left of the plain rows'.
						-->
						<IconWrapper
							name="lucide:chevron-down"
							class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
						/>
						<span class="min-w-0 truncate">
							{group.label}
							<span class="text-meta">· {group.inputKind}</span>
						</span>
						<span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
							{t('component.payslip_adjustment_entries', { count: group.entries.length })}
						</span>
					</span>
					<span>{signedAmount(group.amount, direction)}</span>
				</AccordionTrigger>
				<AccordionContent class="pb-2 pl-10">
					<ul class="text-meta tabular-nums">
						{#each group.entries as entry (entry.id)}
							<li class="flex justify-between gap-4 py-0.5">
								<span>
									#{Number(entry.id) + 1} · {formatNumeric(entry.quantity)} × {formatNumeric(
										entry.rate
									)}
								</span>
								<span>{signedAmount(decodeNumber(entry.amount), direction)}</span>
							</li>
						{/each}
					</ul>
				</AccordionContent>
			</AccordionItem>
		{/if}
	{/each}
{/snippet}

{#snippet schemeInfo(charge: (typeof statutory)[number])}
	{@const detail = schemeTrace.get(charge.scheme_code)}
	<Tooltip
		side="bottom"
		align="start"
		contentClass="max-w-96 border bg-popover text-popover-foreground"
		arrowClasses="text-popover"
	>
		{#snippet trigger({ props })}
			<Button {...props} variant="ghost" size="icon" aria-label={t('component.flow_derivation')}>
				<IconWrapper name="lucide:info" class="size-4" />
			</Button>
		{/snippet}
		{#snippet content()}
			<Stack gap="xs" class="max-h-96 overflow-auto">
				{#if charge.authority}
					<p class="text-xs text-muted-foreground">{charge.authority}</p>
				{/if}
				<table class="w-full text-xs tabular-nums">
					<thead>
						<tr class="text-meta text-left">
							<th class="py-0.5 pr-2 font-normal">{t('component.flow_rule')}</th>
							<th class="py-0.5 pr-2 text-right font-normal"
								>{t('renderer.payslip_statutory.employee_amount')}</th
							>
							<th class="py-0.5 text-right font-normal"
								>{t('renderer.payslip_statutory.employer_amount')}</th
							>
						</tr>
					</thead>
					<tbody>
						<tr class="border-t border-border align-top">
							<td class="py-0.5 pr-2 whitespace-pre-wrap break-all"
								>{prettyRule(charge.rule_when)}</td
							>
							<td class="py-0.5 pr-2 text-right">{formatNumeric(charge.employee_amount)}</td>
							<td class="py-0.5 text-right">{formatNumeric(charge.employer_amount)}</td>
						</tr>
					</tbody>
				</table>
				<p class="text-xs tabular-nums">
					{t('renderer.payslip_statutory.base_amount')}:
					{formatNumeric(charge.base_amount)}
				</p>
				{#if charge.directed_amount}
					<p class="text-xs tabular-nums" data-directed-amount>
						{t('renderer.payslip_statutory.directed_amount')}:
						{formatNumeric(charge.directed_amount)}
					</p>
				{/if}
				{#if detail != null && detail.inputs.length > 0}
					<p class="text-meta">{t('component.flow_inputs')}</p>
					<ul class="text-xs">
						{#each groupedInputs(detail.inputs) as input (input.key)}
							<li class="flex justify-between gap-2 tabular-nums">
								<span class="truncate"
									>{input.label === input.code ? input.code : `${input.code} · ${input.label}`} · {input.effect ===
									'REDUCE'
										? '−'
										: '+'}</span
								>
								<span>{formatNumeric(input.amount)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if detail != null && detail.reads.length > 0}
					<p class="text-meta">{t('component.flow_reads')}</p>
					<ul class="text-xs">
						{#each detail.reads as read (read.code)}
							<li class="flex justify-between gap-2 tabular-nums">
								<span class="truncate">produced.{read.code}.employee</span>
								<span>{formatNumeric(read.employee_amount)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Stack>
		{/snippet}
	</Tooltip>
{/snippet}

{#snippet earningsInfo()}
	<Tooltip
		side="bottom"
		align="start"
		contentClass="max-w-96 border bg-popover text-popover-foreground"
		arrowClasses="text-popover"
	>
		{#snippet trigger({ props })}
			<Button {...props} variant="ghost" size="icon" aria-label={t('component.payslip_base_info')}>
				<IconWrapper name="lucide:info" class="size-4" />
			</Button>
		{/snippet}
		{#snippet content()}
			<Stack gap="xs" class="max-h-96 overflow-auto">
				<p class="text-xs leading-5">{t('component.payslip_base_description')}</p>
				{#if proration.length > 0}
					<p class="text-xs leading-5 text-muted-foreground">
						{t('component.payslip_proration_description')}
					</p>
					<table class="w-full text-xs tabular-nums">
						<thead>
							<tr class="text-meta text-left">
								<th class="py-0.5 pr-2 font-normal">{t('renderer.payslip_proration.segment')}</th>
								<th class="py-0.5 pr-2 text-right font-normal"
									>{t('renderer.payslip_proration.fraction')}</th
								>
								<th class="py-0.5 text-right font-normal"
									>{t('renderer.payslip_proration.prorated_amount')}</th
								>
							</tr>
						</thead>
						<tbody>
							{#each proration as segment, index (`${segment.term_key}:${segment.from}:${index}`)}
								<tr class="border-t border-border">
									<td class="py-0.5 pr-2 whitespace-nowrap"
										>{segment.component_code} · {formatCalendarDate(segment.from)} → {formatCalendarDate(
											segment.to
										)}</td
									>
									<td class="py-0.5 pr-2 text-right">{segment.days} / {segment.denominator}</td>
									<td class="py-0.5 text-right font-medium"
										>{formatNumeric(segment.prorated_amount)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</Stack>
		{/snippet}
	</Tooltip>
{/snippet}

{#snippet statementRow(
	label: string,
	amount: string,
	options?: { emphasis?: boolean; indent?: boolean }
)}
	<div
		class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1 {options?.indent
			? 'pl-4'
			: ''}"
	>
		<span class={options?.emphasis ? 'font-medium' : ''}>{label}</span>
		<span class={options?.emphasis ? 'font-medium' : ''}>{amount}</span>
	</div>
{/snippet}

{#snippet schemeRow(charge: (typeof statutory)[number], direction: 'add' | 'subtract')}
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1 pl-4">
		<span class="flex min-w-0 items-center gap-1">
			<span class="truncate">{schemeLabel(charge)}</span>
			{@render schemeInfo(charge)}
			{#if direction === 'subtract' && charge.employee_amount < 0}
				<span class="text-xs text-muted-foreground" data-refund
					>{t('renderer.payslip_statutory.refund')}</span
				>
			{/if}
		</span>
		<span>
			{signedAmount(
				direction === 'subtract' ? charge.employee_amount : charge.employer_amount,
				direction
			)}
		</span>
	</div>
{/snippet}

<RecordShell
	subtitle={record
		? `${employment?.employment_employee?.name ?? t('component.employee')} · ${employment?.employee_number ?? t('component.employment')}`
		: undefined}
>
	{#if record}
		<Stack gap="lg">
			<Stack as="section" gap="xs" aria-labelledby="payslip-summary-heading">
				<h2 id="payslip-summary-heading" class="text-subhead">
					{employment?.employment_employee?.name ?? t('component.employee')}
				</h2>
				<p class="text-meta">
					{employment?.employee_number ?? t('component.employment')} · {record.currency}
				</p>
			</Stack>

			<Stack
				as="section"
				gap="none"
				class="text-sm tabular-nums"
				aria-labelledby="payslip-statement-heading"
			>
				<Inline justify="between" align="baseline" class="border-b border-border pb-1">
					<h3 id="payslip-statement-heading" class="text-overline">
						{t('component.payslip_statement')}
					</h3>
					<span class="text-meta">{record.currency}</span>
				</Inline>

				<!-- What the contract and this period's inputs paid. -->
				<Inline gap="xs" align="center" class="pt-3 pb-1">
					<span class="text-overline text-muted-foreground">{t('component.payslip_earnings')}</span>
					{@render earningsInfo()}
				</Inline>
				{#each base as entry, index (`base:${entry.component_code}:${index}`)}
					{@render statementRow(entry.component_code, formatNumeric(entry.amount), {
						indent: true
					})}
				{/each}
				<Accordion type="multiple" class="border-0">
					{@render adjustmentRows(earningsGroups, 'add')}
				</Accordion>
				{#if base.length === 0 && earningsGroups.length === 0}
					<p class="pl-4 text-meta">{t('component.payslip_base_none')}</p>
				{/if}
				{@render statementRow(t('component.payslip_total_earnings'), formatNumeric(earningsTotal), {
					emphasis: true
				})}

				<!-- The unpaid time that reduced them. -->
				{#if absenceGroups.length > 0}
					<Inline gap="xs" align="center" class="pt-3 pb-1">
						<span class="text-overline text-muted-foreground"
							>{t('component.payslip_unpaid_time')}</span
						>
						{@render sectionInfo(
							t('component.payslip_adjustments_info'),
							t('component.payslip_adjustments_description')
						)}
					</Inline>
					<Accordion type="multiple" class="border-0">
						{@render adjustmentRows(absenceGroups, 'subtract')}
					</Accordion>
					{@render statementRow(
						t('component.payslip_total_unpaid_time'),
						signedAmount(unpaidTotal, 'subtract'),
						{ emphasis: true }
					)}
				{/if}

				{@render statementRow(t('component.payslip_gross_pay'), formatNumeric(gross), {
					emphasis: true
				})}

				<!-- Withheld from the employee for an authority. -->
				{#if statutory.length > 0}
					<Inline gap="xs" align="center" class="pt-3 pb-1">
						<span class="text-overline text-muted-foreground"
							>{t('component.payslip_statutory_withheld')}</span
						>
						{@render sectionInfo(
							t('component.payslip_statutory_info'),
							t('component.payslip_statutory_description')
						)}
					</Inline>
					{#each statutory as charge, index (`${charge.scheme_code}:employee:${index}`)}
						{@render schemeRow(charge, 'subtract')}
					{/each}
					{@render statementRow(
						t('component.payslip_total_withheld'),
						signedAmount(withheldTotal, 'subtract'),
						{ emphasis: true }
					)}
				{/if}

				<!-- Recovered from the employee for the employer (loan repayments). -->
				{#if deductionGroups.length > 0}
					<Inline gap="xs" align="center" class="pt-3 pb-1">
						<span class="text-overline text-muted-foreground"
							>{t('component.payslip_other_deductions')}</span
						>
					</Inline>
					<Accordion type="multiple" class="border-0">
						{@render adjustmentRows(deductionGroups, 'subtract')}
					</Accordion>
					{@render statementRow(
						t('component.payslip_total_other_deductions'),
						signedAmount(deductionsTotal, 'subtract'),
						{ emphasis: true }
					)}
				{/if}

				<!-- Repaid to the employee; never part of gross. -->
				{#if paymentGroups.length > 0}
					<Inline gap="xs" align="center" class="pt-3 pb-1">
						<span class="text-overline text-muted-foreground"
							>{t('component.payslip_reimbursements')}</span
						>
					</Inline>
					<Accordion type="multiple" class="border-0">
						{@render adjustmentRows(paymentGroups, 'add')}
					</Accordion>
				{/if}

				<!-- Take home. -->
				<Inline justify="between" align="baseline" class="mt-3 border-t border-border pt-2 pb-1">
					<span class="text-heading">{t('component.payslip_net_pay')}</span>
					<span class="text-heading">{formatNumeric(net)}</span>
				</Inline>

				<!-- What the employer owes on top of the settlement. -->
				{#if statutory.length > 0 || employerGroups.length > 0}
					<Inline justify="between" align="baseline" class="pt-4 pb-1">
						<span class="text-overline text-muted-foreground"
							>{t('component.payslip_company_contributions')}</span
						>
					</Inline>
					{#each statutory as charge, index (`${charge.scheme_code}:employer:${index}`)}
						{#if decodeNumber(charge.employer_amount) !== 0}
							{@render schemeRow(charge, 'add')}
						{/if}
					{/each}
					<Accordion type="multiple" class="border-0">
						{@render adjustmentRows(employerGroups, 'add')}
					</Accordion>
					{@render statementRow(
						t('component.payslip_employer_cost_total'),
						formatNumeric(employerCostTotal),
						{ emphasis: true }
					)}
				{/if}

				{#if informationGroups.length > 0}
					<Inline gap="xs" align="center" class="pt-3 pb-1">
						<span class="text-overline text-muted-foreground"
							>{t('component.payslip_information')}</span
						>
					</Inline>
					{#each informationGroups as group (group.key)}
						{@render statementRow(
							`${group.label} · ${group.inputKind}`,
							formatNumeric(group.amount),
							{ indent: true }
						)}
					{/each}
				{/if}

				<Inline
					justify="between"
					align="baseline"
					class="mt-3 border-t-2 border-foreground/20 pt-2"
				>
					<span class="font-medium">{t('component.payslip_total_cost')}</span>
					<span class="font-medium">{formatNumeric(companyCost)}</span>
				</Inline>
				<p class="text-meta">
					{t('component.payslip_of_which_authorities')}: {formatNumeric(authoritiesTotal)}
				</p>
			</Stack>

			{#if decodeNumber(record.unfunded_contributions) > 0}
				<Stack
					as="section"
					gap="sm"
					class="border-t border-border pt-4"
					aria-labelledby="payslip-funding-heading"
				>
					<h3 id="payslip-funding-heading" class="text-subhead">
						{t('component.contribution_funding')}
					</h3>
					<p class="text-meta">{t('component.contribution_funding_hint')}</p>
					<Grid as="dl" gap="sm" minimum="compact">
						<Stack gap="xs">
							<dt class="text-meta">{t('component.unfunded_contributions')}</dt>
							<dd class="tabular-nums">{formatNumeric(record.unfunded_contributions)}</dd>
						</Stack>
						<Stack gap="xs">
							<dt class="text-meta">{t('component.funding_outstanding')}</dt>
							<dd class="tabular-nums">
								{formatNumeric(
									Math.max(
										0,
										decodeNumber(record.unfunded_contributions) -
											decodeNumber(record.funding_received)
									)
								)}
							</dd>
						</Stack>
					</Grid>
					<CollectionForm
						{client}
						collection="payslips"
						defaultValues={record}
						disabled={record.status === 'PAID'}
						submitLabel={t('component.save_funding')}
					>
						{#snippet children({ Field })}
							<Field name="status" hidden />
							<Field name="paid_at" hidden />
							<Grid gap="sm" minimum="compact">
								<Field name="funding_received" label={t('component.funding_received')} />
								<Field name="funding_received_on" label={t('component.funding_received_on')} />
								<Field name="funding_reference" label={t('component.funding_reference')} />
							</Grid>
						{/snippet}
					</CollectionForm>
				</Stack>
			{/if}
		</Stack>
	{:else}
		<p class="text-sm text-muted-foreground">
			A payslip is written by the payroll engine, never by hand: create a payroll run for the
			company and period, and the run produces one payslip per employment it covers.
		</p>
	{/if}
</RecordShell>
