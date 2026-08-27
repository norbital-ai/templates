<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	/** One person's settlement. Every row below is the physical payslip-to-component junction. */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Result, Schema } from 'effect';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	// CollectionTable erases its query-specific row type at the render callback, so nested values are
	// decoded once at that boundary instead of cast by hand.
	const componentRefSchema = Schema.Struct({
		code: Schema.optional(Schema.NullOr(Schema.String)),
		name: Schema.optional(Schema.NullOr(Schema.String))
	});
	const payslipLineRefSchema = Schema.Struct({
		description: Schema.optional(Schema.NullOr(Schema.String)),
		event_date: Schema.optional(Schema.NullOr(Schema.String))
	});
	const nestedLineSchema = Schema.Struct({
		payslip_line_pay_component: Schema.optional(Schema.NullOr(componentRefSchema)),
		entry_payslip_lines: Schema.optional(Schema.NullOr(payslipLineRefSchema)),
		payslip_line_statutory_contribution: Schema.optional(Schema.NullOr(componentRefSchema))
	});
	type NestedLine = Schema.Schema.Type<typeof nestedLineSchema>;
	const attendanceSourceSchema = Schema.Struct({
		work_date: Schema.optional(Schema.NullOr(Schema.String)),
		time_entry_employment: Schema.optional(
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
	const nestedSourceSchema = Schema.Struct({
		source: Schema.Union([
			Schema.Struct({
				kind: Schema.Literal('TIME_ENTRY'),
				id: Schema.String,
				record: Schema.NullOr(attendanceSourceSchema)
			}),
			Schema.Struct({
				kind: Schema.Literal('LEAVE_REQUEST'),
				id: Schema.String,
				record: Schema.NullOr(leaveSourceSchema)
			})
		])
	});
	type NestedSource = Schema.Schema.Type<typeof nestedSourceSchema>;
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

	const decodeNestedLine = Schema.decodeUnknownResult(nestedLineSchema);
	const decodeNestedSource = Schema.decodeUnknownResult(nestedSourceSchema);
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

	function componentLabel(row: unknown): string {
		const parsed = decodeNestedLine(row);
		if (!Result.isSuccess(parsed)) return t('component.derived_line');
		const component = parsed.success.payslip_line_pay_component;
		if (component?.code) return component.code;
		const statutory = parsed.success.payslip_line_statutory_contribution;
		if (statutory?.code)
			return statutory.name ? `${statutory.code} · ${statutory.name}` : statutory.code;
		return t('component.derived_line');
	}

	function entryLabel(row: unknown): string {
		const parsed = decodeNestedLine(row);
		if (!Result.isSuccess(parsed)) return '—';
		const entry = parsed.success.entry_payslip_lines;
		if (entry?.description) return entry.description;
		return entry?.event_date == null ? '—' : formatCalendarDate(entry.event_date);
	}

	function sourceKind(row: unknown): string {
		const parsed = decodeNestedSource(row);
		if (!Result.isSuccess(parsed)) return '—';
		return parsed.success.source.kind === 'TIME_ENTRY'
			? t('component.attendance')
			: t('component.leave');
	}

	function sourceDetail(row: unknown): string {
		const parsed = decodeNestedSource(row);
		if (!Result.isSuccess(parsed)) return '—';
		const attendance =
			parsed.success.source.kind === 'TIME_ENTRY' ? parsed.success.source.record : null;
		if (attendance?.work_date) {
			const employee = attendance.time_entry_employment?.employee_number;
			return [employee, formatCalendarDate(attendance.work_date)].filter(Boolean).join(' · ');
		}
		const leave =
			parsed.success.source.kind === 'LEAVE_REQUEST' ? parsed.success.source.record : null;
		if (leave?.from_date) {
			const range = leave.to_date
				? `${formatCalendarDate(leave.from_date)} → ${formatCalendarDate(leave.to_date)}`
				: formatCalendarDate(leave.from_date);
			return [leave.leave_request_type?.code, range].filter(Boolean).join(' · ');
		}
		return '—';
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
			aria-labelledby="payslip-lines-heading"
		>
			<h3 id="payslip-lines-heading" class="text-sm font-semibold">
				{t('component.component_breakdown')}
			</h3>
			<p class="text-meta">
				{t('component.component_breakdown_description')}
			</p>
			<Bound size="standard">
				<CollectionTable
					{client}
					collection="payslip_lines"
					title={t('component.component_breakdown')}
					description={t('component.payslips_description')}
					features={{ create: false }}
					query={{
						where: { payslip_id: { eq: record.id } },
						orderBy: { sequence: 'asc' },
						with: {
							payslip_line_pay_component: { columns: { code: true } },
							entry_payslip_lines: { columns: { description: true, event_date: true } },
							payslip_line_statutory_contribution: { columns: { code: true, name: true } }
						},
						limit: 200
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
						<Column name="component" label={t('component.line_kind')} card="subtitle" />
						<Column
							name="component_entry_id"
							label={t('component.input_entry')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => entryLabel(row) }}
						/>
						<Column name="bucket" card="badge" />
						<Column name="quantity" />
						<Column name="rate" />
						<Column name="amount" card="badge" />
					{/snippet}
				</CollectionTable>
			</Bound>
		</Stack>

		<Stack
			as="section"
			gap="sm"
			class="border-t border-border pt-4"
			aria-labelledby="payslip-inputs-heading"
		>
			<h3 id="payslip-inputs-heading" class="text-sm font-semibold">
				{t('component.consumed_inputs')}
			</h3>
			<p class="text-meta">{t('component.consumed_inputs_description')}</p>
			<Bound size="standard">
				<CollectionTable
					{client}
					collection="payslip_sources"
					title={t('component.consumed_inputs')}
					description={t('component.consumed_inputs_description')}
					features={{ create: false }}
					query={{
						where: { payslip_id: { eq: record.id } },
						with: {
							source: {
								TIME_ENTRY: {
									columns: { work_date: true },
									with: { time_entry_employment: { columns: { employee_number: true } } }
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
						<Column
							name="source"
							label={t('component.input_type')}
							card="title"
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => sourceKind(row) }}
						/>
						<Column
							name="period"
							label={t('component.source_record')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => sourceDetail(row) }}
						/>
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
