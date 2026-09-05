<script lang="ts">
	/**
	 * One person's settlement, in its two deliberately separate halves.
	 *
	 * OUTPUTS: BASE, PRORATION and STATUTORY are columns on this record — they are caused by no
	 * input, which is exactly why they are inlined — so they are read straight off `record` and need
	 * no table. ADJUSTMENTS is the one output relation: a row exists there only when exactly one
	 * captured input caused it.
	 *
	 * INPUTS are the four junction relations — work days, component entries, leave requests, loan
	 * repayments — each a real FK into the business source. They are read beside the adjustments so
	 * the payslip answers "what was read" as directly as it answers "what was calculated".
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { Button } from '@norbital-ai/ui/button';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import { Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		Accordion,
		AccordionContent,
		AccordionItem,
		AccordionTrigger
	} from '@norbital-ai/ui/accordion';
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { Result, Schema } from 'effect';
	import { decodeNumber } from '@norbital-ai/std/json';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const adjustmentInputSchema = Schema.Union([
		Schema.Struct({ kind: Schema.Literal('WORK_DAY_INPUT'), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal('COMPONENT_ENTRY_INPUT'), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal('LEAVE_REQUEST_INPUT'), id: Schema.String }),
		Schema.Struct({ kind: Schema.Literal('LOAN_REPAYMENT_INPUT'), id: Schema.String })
	]);
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

	const decodeAdjustmentInput = Schema.decodeUnknownResult(adjustmentInputSchema);
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

	const adjustmentsQuery = $derived(
		record == null
			? null
			: client.db.payslip_adjustments.findMany({
					where: { payslip_id: { eq: record.id } },
					orderBy: { sequence: 'asc' },
					columns: {
						id: true,
						sequence: true,
						label: true,
						bucket: true,
						amount: true,
						quantity: true,
						rate: true,
						input: true
					},
					limit: 500
				})
	);
	const adjustments = $derived(adjustmentsQuery?.current ?? []);

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
	 * One accordion row per component: the same label, input kind, bucket and rate collapse into a
	 * summed line, and the individual entries — one per captured input — sit behind it. A component
	 * that occurred once is a plain row; there is nothing to unfold.
	 */
	const adjustmentGroups = $derived.by((): AdjustmentGroup[] => {
		const groups = new Map<string, AdjustmentGroup>();
		for (const adjustment of adjustments) {
			const kind = inputKind(adjustment.input);
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
	});

	function inputKind(input: unknown): string {
		const parsed = decodeAdjustmentInput(input);
		if (!Result.isSuccess(parsed)) return '—';
		switch (parsed.success.kind) {
			case 'COMPONENT_ENTRY_INPUT':
				return t('component.entry_kind');
			case 'WORK_DAY_INPUT':
				return t('component.attendance');
			case 'LEAVE_REQUEST_INPUT':
				return t('component.leave');
			case 'LOAN_REPAYMENT_INPUT':
				return t('app.loans.agreements');
			default: {
				const _never: never = parsed.success;
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

{#if record}
	<Stack gap="lg">
		<Stack as="section" gap="sm" aria-labelledby="payslip-summary-heading">
			<h2 id="payslip-summary-heading" class="text-subhead">
				{employment?.employment_employee?.name ?? t('component.employee')}
			</h2>
			<p class="text-sm text-muted-foreground">
				{employment?.employee_number ?? t('component.employment')} · {record.currency}
			</p>
			<Grid as="dl" gap="sm" minimum="compact">
				<Stack gap="xs">
					<dt class="text-meta">{t('component.gross')}</dt>
					<dd class="font-semibold tabular-nums">{formatNumeric(record.gross)}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{t('component.deductions')}</dt>
					<dd class="font-semibold tabular-nums">{formatNumeric(record.total_deductions)}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{t('component.net')}</dt>
					<dd class="text-lg font-bold tabular-nums">{formatNumeric(record.net)}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{t('component.employer_cost')}</dt>
					<dd class="font-semibold tabular-nums">{formatNumeric(record.employer_cost)}</dd>
				</Stack>
			</Grid>
		</Stack>

		<Stack
			as="section"
			gap="sm"
			class="border-t border-border pt-4"
			aria-labelledby="payslip-base-heading"
		>
			<Inline gap="xs" align="center">
				<h3 id="payslip-base-heading" class="text-sm font-semibold">
					{t('component.payslip_base')}
				</h3>
				{@render sectionInfo(
					t('component.payslip_base_info'),
					t('component.payslip_base_description')
				)}
			</Inline>
			{#if base.length === 0}
				<p class="text-sm text-muted-foreground">{t('component.payslip_base_none')}</p>
			{:else}
				<Stack as="ul" gap="none" class="text-sm tabular-nums">
					{#each base as entry, index (`${entry.component_code}:${index}`)}
						<Inline as="li" justify="between" gap="sm" class="border-t border-border py-1">
							<span class="truncate">{entry.component_code}</span>
							<span class="font-medium">{formatNumeric(entry.amount)}</span>
						</Inline>
					{/each}
				</Stack>
			{/if}
		</Stack>

		{#if proration.length > 0}
			<Accordion type="multiple" class="border-t border-border">
				<AccordionItem value="proration">
					<AccordionTrigger class="text-sm font-semibold hover:no-underline">
						{t('component.payslip_proration')}
					</AccordionTrigger>
					<AccordionContent>
						<p class="mb-3 text-sm text-muted-foreground">
							{t('component.payslip_proration_description')}
						</p>
						<Scroll axis="x" name={t('component.payslip_proration')}>
							<table class="w-full text-sm tabular-nums">
								<thead>
									<tr class="text-meta text-left">
										<th class="py-1 pr-3 font-normal">{t('renderer.payslip_proration.segment')}</th>
										<th class="py-1 pr-3 text-right font-normal"
											>{t('renderer.payslip_proration.fraction')}</th
										>
										<th class="py-1 pr-3 text-right font-normal"
											>{t('renderer.payslip_proration.contract_amount')}</th
										>
										<th class="py-1 text-right font-normal"
											>{t('renderer.payslip_proration.prorated_amount')}</th
										>
									</tr>
								</thead>
								<tbody>
									{#each proration as segment, index (`${segment.term_key}:${segment.from}:${index}`)}
										<tr class="border-t border-border">
											<td class="py-1 pr-3 whitespace-nowrap"
												>{formatCalendarDate(segment.from)} → {formatCalendarDate(segment.to)}</td
											>
											<td class="py-1 pr-3 text-right">{segment.days} / {segment.denominator}</td>
											<td class="py-1 pr-3 text-right">{formatNumeric(segment.contract_amount)}</td>
											<td class="py-1 text-right font-medium"
												>{formatNumeric(segment.prorated_amount)}</td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						</Scroll>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		{/if}

		{#if statutory.length > 0}
			<Stack
				as="section"
				gap="sm"
				class="border-t border-border pt-4"
				aria-labelledby="payslip-statutory-heading"
			>
				<Inline gap="xs" align="center">
					<h3 id="payslip-statutory-heading" class="text-sm font-semibold">
						{t('component.payslip_statutory')}
					</h3>
					{@render sectionInfo(
						t('component.payslip_statutory_info'),
						t('component.payslip_statutory_description')
					)}
				</Inline>
				<Scroll axis="x" name={t('component.payslip_statutory')}>
					<table class="w-full text-sm tabular-nums">
						<thead>
							<tr class="text-meta text-left">
								<th class="py-1 pr-3 font-normal">{t('component.code')}</th>
								<th class="py-1 pr-3 font-normal">{t('renderer.payslip_statutory.band')}</th>
								<th class="py-1 pr-3 text-right font-normal"
									>{t('renderer.payslip_statutory.base_amount')}</th
								>
								<th class="py-1 pr-3 text-right font-normal"
									>{t('renderer.payslip_statutory.employee_amount')}</th
								>
								<th class="py-1 text-right font-normal"
									>{t('renderer.payslip_statutory.employer_amount')}</th
								>
							</tr>
						</thead>
						<tbody>
							{#each statutory as charge, index (`${charge.scheme_code}:${index}`)}
								<tr class="border-t border-border">
									<td class="py-1 pr-3 whitespace-nowrap">
										<Inline gap="xs" align="center">
											<span>{charge.scheme_code}</span>
											{#if charge.authority}
												{@render sectionInfo(
													t('component.payslip_statutory_authority'),
													charge.authority
												)}
											{/if}
										</Inline>
									</td>
									<td class="py-1 pr-3">{charge.band_key ?? '—'}</td>
									<td class="py-1 pr-3 text-right">{formatNumeric(charge.base_amount)}</td>
									<td class="py-1 pr-3 text-right font-medium"
										>{formatNumeric(charge.employee_amount)}</td
									>
									<td class="py-1 text-right">{formatNumeric(charge.employer_amount)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Scroll>
			</Stack>
		{/if}

		<Stack
			as="section"
			gap="sm"
			class="border-t border-border pt-4"
			aria-labelledby="payslip-adjustments-heading"
		>
			<Inline gap="xs" align="center">
				<h3 id="payslip-adjustments-heading" class="text-sm font-semibold">
					{t('component.payslip_adjustments')}
				</h3>
				{@render sectionInfo(
					t('component.payslip_adjustments_info'),
					t('component.payslip_adjustments_description')
				)}
			</Inline>
			{#if adjustments.length === 0}
				<p class="text-sm text-muted-foreground">{t('component.payslip_adjustments_none')}</p>
			{:else}
				<Scroll axis="x" name={t('component.payslip_adjustments')}>
					<div class="min-w-[40rem] text-sm tabular-nums" data-payslip-adjustments>
						<div
							class="grid grid-cols-[minmax(14rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_5rem_5rem_6rem] gap-x-3 px-1 py-1 text-meta"
						>
							<span>{t('component.component')}</span>
							<span>{t('component.input_type')}</span>
							<span>{t('component.bucket')}</span>
							<span class="text-right">{t('component.quantity')}</span>
							<span class="text-right">{t('component.rate')}</span>
							<span class="text-right">{t('component.amount')}</span>
						</div>
						<Accordion type="multiple" class="border-t border-border">
							{#each adjustmentGroups as group (group.key)}
								{#if group.entries.length === 1}
									<div
										class="grid grid-cols-[minmax(14rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_5rem_5rem_6rem] items-center gap-x-3 border-b border-border px-1 py-2"
										data-adjustment-group={group.key}
									>
										<span class="truncate">{group.label}</span>
										<span>{group.inputKind}</span>
										<span>{group.bucket ?? '—'}</span>
										<span class="text-right">{formatNumeric(group.quantity)}</span>
										<span class="text-right">{formatNumeric(group.rate)}</span>
										<span class="text-right font-medium">{formatNumeric(group.amount)}</span>
									</div>
								{:else}
									<AccordionItem
										value={group.key}
										class="border-b border-border"
										data-adjustment-group={group.key}
									>
										<AccordionTrigger class="py-2 hover:no-underline">
											<div
												class="grid flex-1 grid-cols-[minmax(14rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_5rem_5rem_6rem] items-center gap-x-3 px-1 font-normal"
											>
												<span class="flex min-w-0 items-center gap-2">
													<span class="truncate">{group.label}</span>
													<span
														class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
													>
														{t('component.payslip_adjustment_entries', {
															count: group.entries.length
														})}
													</span>
												</span>
												<span>{group.inputKind}</span>
												<span>{group.bucket ?? '—'}</span>
												<span class="text-right">{formatNumeric(group.quantity)}</span>
												<span class="text-right">{formatNumeric(group.rate)}</span>
												<span class="text-right font-medium">{formatNumeric(group.amount)}</span>
											</div>
										</AccordionTrigger>
										<AccordionContent class="pb-2">
											<div class="rounded-md bg-muted/40">
												{#each group.entries as entry (entry.id)}
													<div
														class="grid grid-cols-[minmax(14rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_5rem_5rem_6rem] items-center gap-x-3 px-1 py-1 text-muted-foreground"
													>
														<span class="pl-4">#{entry.sequence}</span>
														<span></span>
														<span></span>
														<span class="text-right">{formatNumeric(entry.quantity)}</span>
														<span class="text-right">{formatNumeric(entry.rate)}</span>
														<span class="text-right">{formatNumeric(entry.amount)}</span>
													</div>
												{/each}
											</div>
										</AccordionContent>
									</AccordionItem>
								{/if}
							{/each}
						</Accordion>
					</div>
				</Scroll>
			{/if}
		</Stack>
	</Stack>
{:else}
	<p class="text-sm text-muted-foreground">
		A payslip is written by the payroll engine, never by hand: create a payroll run for the company
		and period, and the run produces one payslip per employment it covers.
	</p>
{/if}
