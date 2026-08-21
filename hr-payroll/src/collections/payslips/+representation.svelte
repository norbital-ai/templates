<script lang="ts">
	/** One person's settlement. Every row below is the physical payslip-to-component junction. */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Grid, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	type PayslipSummary = {
		readonly payslip_employment?: {
			readonly employee_number?: string | null;
			readonly employment_employee?: { readonly name?: string | null } | null;
		} | null;
	};
	type NestedLine = {
		readonly payslip_line_pay_component?: {
			readonly code?: string | null;
			readonly name?: string | null;
		} | null;
		readonly entry_payslip_lines?: {
			readonly description?: string | null;
			readonly event_date?: string | null;
		} | null;
		readonly payslip_line_statutory_contribution?: {
			readonly code?: string | null;
			readonly name?: string | null;
		} | null;
	};
	type NestedSource = {
		readonly payslip_source_time_entry?: {
			readonly work_date?: string | null;
			readonly time_entry_employment?: { readonly employee_number?: string | null } | null;
		} | null;
		readonly payslip_source_leave_request?: {
			readonly from_date?: string | null;
			readonly to_date?: string | null;
			readonly leave_request_type?: { readonly code?: string | null } | null;
		} | null;
	};

	const summaryQuery = $derived(
		record == null
			? null
			: client.db.payslips.findFirst({
					where: { norbital_id: { eq: record.norbital_id } },
					columns: { norbital_id: true },
					with: {
						payslip_employment: {
							columns: { employee_number: true },
							with: { employment_employee: { columns: { name: true } } }
						}
					}
				})
	);
	const summary = $derived(summaryQuery?.current as PayslipSummary | null | undefined);
	const employment = $derived(summary?.payslip_employment ?? null);

	function componentLabel(row: unknown): string {
		const line = row as NestedLine;
		const component = line.payslip_line_pay_component;
		if (component?.code) return component.code;
		const statutory = line.payslip_line_statutory_contribution;
		if (statutory?.code)
			return statutory.name ? `${statutory.code} · ${statutory.name}` : statutory.code;
		return t('component.derived_line');
	}

	function entryLabel(row: unknown): string {
		const entry = (row as NestedLine).entry_payslip_lines;
		if (entry?.description) return entry.description;
		return entry?.event_date == null ? '—' : formatCalendarDate(entry.event_date);
	}

	function sourceKind(row: unknown): string {
		const source = row as NestedSource;
		if (source.payslip_source_time_entry) return t('component.attendance');
		if (source.payslip_source_leave_request) return t('component.leave');
		return '—';
	}

	function sourceDetail(row: unknown): string {
		const source = row as NestedSource;
		const attendance = source.payslip_source_time_entry;
		if (attendance?.work_date) {
			const employee = attendance.time_entry_employment?.employee_number;
			return [employee, formatCalendarDate(attendance.work_date)].filter(Boolean).join(' · ');
		}
		const leave = source.payslip_source_leave_request;
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
						where: { payslip_id: { eq: record.norbital_id } },
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
							render={({ row }) => componentLabel(row)}
						/>
						<Column name="component" label={t('component.line_kind')} card="subtitle" />
						<Column
							name="component_entry_id"
							label={t('component.input_entry')}
							render={({ row }) => entryLabel(row)}
						/>
						<Column name="bucket" card="badge" />
						<Column name="quantity" render={({ value }) => formatNumeric(value)} />
						<Column name="rate" render={({ value }) => formatNumeric(value)} />
						<Column name="amount" card="badge" render={({ value }) => formatNumeric(value)} />
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
						where: { payslip_id: { eq: record.norbital_id } },
						with: {
							payslip_source_time_entry: {
								columns: { work_date: true },
								with: { time_entry_employment: { columns: { employee_number: true } } }
							},
							payslip_source_leave_request: {
								columns: { from_date: true, to_date: true },
								with: { leave_request_type: { columns: { code: true } } }
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
							render={({ row }) => sourceKind(row)}
						/>
						<Column
							name="time_entry_id"
							label={t('component.source_record')}
							card="subtitle"
							sortable={false}
							render={({ row }) => sourceDetail(row)}
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
