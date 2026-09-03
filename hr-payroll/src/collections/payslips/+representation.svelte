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
	import { Tooltip } from '@norbital-ai/ui/tooltip';
	import { Result, Schema } from 'effect';
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
			<Stack
				as="section"
				gap="sm"
				class="border-t border-border pt-4"
				aria-labelledby="payslip-proration-heading"
			>
				<Inline gap="xs" align="center">
					<h3 id="payslip-proration-heading" class="text-sm font-semibold">
						{t('component.payslip_proration')}
					</h3>
					{@render sectionInfo(
						t('component.payslip_proration_info'),
						t('component.payslip_proration_description')
					)}
				</Inline>
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
			</Stack>
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
					<table class="w-full text-sm tabular-nums">
						<thead>
							<tr class="text-meta text-left">
								<th class="py-1 pr-3 font-normal">{t('component.sequence_hash')}</th>
								<th class="py-1 pr-3 font-normal">{t('component.component')}</th>
								<th class="py-1 pr-3 font-normal">{t('component.input_type')}</th>
								<th class="py-1 pr-3 font-normal">{t('component.bucket')}</th>
								<th class="py-1 pr-3 text-right font-normal">{t('component.quantity')}</th>
								<th class="py-1 pr-3 text-right font-normal">{t('component.rate')}</th>
								<th class="py-1 text-right font-normal">{t('component.amount')}</th>
							</tr>
						</thead>
						<tbody>
							{#each adjustments as adjustment (adjustment.id)}
								<tr class="border-t border-border">
									<td class="py-1 pr-3">{adjustment.sequence}</td>
									<td class="py-1 pr-3">{adjustment.label}</td>
									<td class="py-1 pr-3">{inputKind(adjustment.input)}</td>
									<td class="py-1 pr-3">{adjustment.bucket}</td>
									<td class="py-1 pr-3 text-right">{formatNumeric(adjustment.quantity)}</td>
									<td class="py-1 pr-3 text-right">{formatNumeric(adjustment.rate)}</td>
									<td class="py-1 text-right font-medium">{formatNumeric(adjustment.amount)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
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
