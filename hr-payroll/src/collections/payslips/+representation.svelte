<script lang="ts">
	/**
	 * One person's settlement, in the four things a payslip comprises.
	 *
	 * BASE, PRORATION and STATUTORY are columns on this record — they point at no input, which is
	 * exactly why they are inlined — so they are read straight off `record` and need no table.
	 * ADJUSTMENTS is the one relation, and the one polymorphic thing: a row exists there only when
	 * there is a single concrete input to name.
	 *
	 * This replaces two tables. `payslip_lines` said what was produced and `payslip_sources` said
	 * what was read, and every question about overtime needed both — the line named a statutory band
	 * and the clock records that priced it sat in another table with no amount on them. One row says
	 * both now, and a row that produced nothing is a zero, not an absence.
	 */
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Result, Schema } from 'effect';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	// CollectionTable erases its query-specific row type at the render callback, so nested values are
	// decoded once at that boundary instead of cast by hand.
	const obligationSourceSchema = Schema.Struct({
		reference: Schema.optional(Schema.NullOr(Schema.String)),
		description: Schema.optional(Schema.NullOr(Schema.String)),
		event_date: Schema.optional(Schema.NullOr(Schema.String))
	});
	const workDaySourceSchema = Schema.Struct({
		work_date: Schema.optional(Schema.NullOr(Schema.String)),
		work_day_employment: Schema.optional(
			Schema.NullOr(
				Schema.Struct({ employee_number: Schema.optional(Schema.NullOr(Schema.String)) })
			)
		)
	});
	const leaveSourceSchema = Schema.Struct({
		from_date: Schema.optional(Schema.NullOr(Schema.String)),
		to_date: Schema.optional(Schema.NullOr(Schema.String)),
		leave_request_type: Schema.optional(
			Schema.NullOr(Schema.Struct({ code: Schema.optional(Schema.NullOr(Schema.String)) }))
		)
	});
	const adjustmentRowSchema = Schema.Struct({
		payslip_adjustment_pay_component: Schema.optional(
			Schema.NullOr(Schema.Struct({ code: Schema.optional(Schema.NullOr(Schema.String)) }))
		),
		source: Schema.Union([
			Schema.Struct({
				kind: Schema.Literal('OBLIGATION'),
				id: Schema.String,
				record: Schema.NullOr(obligationSourceSchema)
			}),
			Schema.Struct({
				kind: Schema.Literal('WORK_DAY'),
				id: Schema.String,
				record: Schema.NullOr(workDaySourceSchema)
			}),
			Schema.Struct({
				kind: Schema.Literal('LEAVE_REQUEST'),
				id: Schema.String,
				record: Schema.NullOr(leaveSourceSchema)
			})
		])
	});
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

	const decodeAdjustmentRow = Schema.decodeUnknownResult(adjustmentRowSchema);
	const decodePayslipSummary = Schema.decodeUnknownResult(payslipSummarySchema);

	const summaryQuery = $derived(
		record == null
			? null
			: client.db.payslips.findFirst({
					where: { id: { eq: record.id } },
					columns: { id: true },
					with: {
						payslip_employment: {
							columns: { employee_number: true },
							with: { employment_employee: { columns: { name: true } } }
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
	 * The catalogue names the inlined arrays deliberately do not carry.
	 *
	 * `payslips.base` holds a `pay_components` id and no foreign key, because a settled payslip is a
	 * frozen statement of what was paid and does not become wrong when a component is archived. The
	 * screen still has to say `BASIC` rather than a uuid, so it resolves the ids it is holding — one
	 * query for the whole payslip, not one per row.
	 */
	const base = $derived(record?.base ?? []);
	const proration = $derived(record?.proration ?? []);
	const statutory = $derived(record?.statutory ?? []);

	/** Distinct ids to look up, or nothing to ask — the shape both catalogue reads below share. */
	const catalogueIds = (values: readonly string[]): readonly string[] | null => {
		const ids = [...new Set(values)];
		return ids.length === 0 ? null : ids;
	};
	const CATALOGUE_LIMIT = 200;
	/** Both catalogue reads ask the same question of different collections. */
	const catalogueQuery = (ids: readonly string[]) =>
		({
			where: { id: { in: ids } },
			columns: { id: true, code: true },
			limit: CATALOGUE_LIMIT
		}) as const;

	const componentsQuery = $derived.by(() => {
		const ids = catalogueIds(base.map((entry) => entry.pay_component_id));
		return ids == null ? null : client.db.pay_components.findMany(catalogueQuery(ids));
	});
	const componentLabelById = $derived(
		new Map((componentsQuery?.current ?? []).map((component) => [component.id, component.code]))
	);

	const schemesQuery = $derived.by(() => {
		const ids = catalogueIds(statutory.map((charge) => charge.statutory_contribution_id));
		return ids == null ? null : client.db.statutory_contributions.findMany(catalogueQuery(ids));
	});
	const schemeLabelById = $derived(
		new Map(
			(schemesQuery?.current ?? []).map((scheme) => [
				scheme.id,
				[scheme.code, scheme.name].filter((part) => part != null && part !== '').join(' · ')
			])
		)
	);

	function componentLabel(row: unknown): string {
		const parsed = decodeAdjustmentRow(row);
		if (!Result.isSuccess(parsed)) return t('component.derived_line');
		const code = parsed.success.payslip_adjustment_pay_component?.code;
		return code ? code : t('component.derived_line');
	}

	function sourceKind(row: unknown): string {
		const parsed = decodeAdjustmentRow(row);
		if (!Result.isSuccess(parsed)) return '—';
		switch (parsed.success.source.kind) {
			case 'OBLIGATION':
				return t('component.obligation');
			case 'WORK_DAY':
				return t('component.attendance');
			case 'LEAVE_REQUEST':
				return t('component.leave');
		}
	}

	function sourceDetail(row: unknown): string {
		const parsed = decodeAdjustmentRow(row);
		if (!Result.isSuccess(parsed)) return '—';
		const source = parsed.success.source;
		if (source.kind === 'OBLIGATION') {
			const obligation = source.record;
			if (obligation == null) return '—';
			const named = obligation.reference ?? obligation.description;
			if (named) return named;
			return obligation.event_date == null ? '—' : formatCalendarDate(obligation.event_date);
		}
		if (source.kind === 'WORK_DAY') {
			const day = source.record;
			if (day?.work_date == null) return '—';
			return [day.work_day_employment?.employee_number, formatCalendarDate(day.work_date)]
				.filter(Boolean)
				.join(' · ');
		}
		const leave = source.record;
		if (leave?.from_date == null) return '—';
		const range = leave.to_date
			? `${formatCalendarDate(leave.from_date)} → ${formatCalendarDate(leave.to_date)}`
			: formatCalendarDate(leave.from_date);
		return [leave.leave_request_type?.code, range].filter(Boolean).join(' · ');
	}
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/payslips-banner.svg"
	/>
</svelte:head>

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
			<h3 id="payslip-base-heading" class="text-sm font-semibold">{t('component.payslip_base')}</h3>
			<p class="text-meta">{t('component.payslip_base_description')}</p>
			{#if base.length === 0}
				<p class="text-sm text-muted-foreground">{t('component.payslip_base_none')}</p>
			{:else}
				<Stack as="ul" gap="none" class="text-sm tabular-nums">
					{#each base as entry (entry.pay_component_id)}
						<Inline as="li" justify="between" gap="sm" class="border-t border-border py-1">
							<span class="truncate"
								>{componentLabelById.get(entry.pay_component_id) ?? entry.pay_component_id}</span
							>
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
				<h3 id="payslip-proration-heading" class="text-sm font-semibold">
					{t('component.payslip_proration')}
				</h3>
				<p class="text-meta">{t('component.payslip_proration_description')}</p>
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
							{#each proration as segment (`${segment.term_id}:${segment.from}`)}
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
				<h3 id="payslip-statutory-heading" class="text-sm font-semibold">
					{t('component.payslip_statutory')}
				</h3>
				<p class="text-meta">{t('component.payslip_statutory_description')}</p>
				<Scroll axis="x" name={t('component.payslip_statutory')}>
					<table class="w-full text-sm tabular-nums">
						<thead>
							<tr class="text-meta text-left">
								<th class="py-1 pr-3 font-normal">{t('component.statutory_scheme')}</th>
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
							{#each statutory as charge (charge.statutory_contribution_id)}
								<tr class="border-t border-border">
									<td class="py-1 pr-3"
										>{schemeLabelById.get(charge.statutory_contribution_id) ??
											charge.statutory_contribution_id}</td
									>
									<td class="py-1 pr-3">{charge.band_reference ?? '—'}</td>
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
			<h3 id="payslip-adjustments-heading" class="text-sm font-semibold">
				{t('component.payslip_adjustments')}
			</h3>
			<p class="text-meta">{t('component.payslip_adjustments_description')}</p>
			<Bound size="standard">
				<CollectionTable
					{client}
					collection="payslip_adjustments"
					title={t('component.payslip_adjustments')}
					description={t('component.payslip_adjustments_description')}
					features={{ create: false }}
					query={{
						where: { payslip_id: { eq: record.id } },
						orderBy: { sequence: 'asc' },
						with: {
							payslip_adjustment_pay_component: { columns: { code: true } },
							source: {
								OBLIGATION: {
									columns: { reference: true, description: true, event_date: true }
								},
								WORK_DAY: {
									columns: { work_date: true },
									with: { work_day_employment: { columns: { employee_number: true } } }
								},
								LEAVE_REQUEST: {
									columns: { from_date: true, to_date: true },
									with: { leave_request_type: { columns: { code: true } } }
								}
							}
						},
						limit: 500
					}}
				>
					{#snippet columns({ Column })}
						<Column name="sequence" label={t('component.sequence_hash')} />
						<Column
							name="pay_component_id"
							label={t('component.component')}
							card="title"
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => componentLabel(row) }}
						/>
						<Column name="overtime_band" label={t('component.overtime_band')} />
						<Column
							name="source"
							label={t('component.input_type')}
							card="subtitle"
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => sourceKind(row) }}
						/>
						<Column
							name="period"
							label={t('component.source_record')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => sourceDetail(row) }}
						/>
						<Column name="bucket" card="badge" />
						<Column name="quantity" />
						<Column name="rate" />
						<Column name="amount" card="badge" />
					{/snippet}
				</CollectionTable>
			</Bound>
		</Stack>
	</Stack>
{:else}
	<p class="text-sm text-muted-foreground">
		A payslip is written by the payroll engine, never by hand: create a payroll run for the company
		and period, and the run produces one payslip per employment it covers.
	</p>
{/if}
