<script lang="ts">
	/**
	 * One payslip as a statement: who, which run, its payment state, and every line the build wrote — earnings
	 * (contract lines and pay entries), deductions (the employee's statutory share and recoveries from net),
	 * reimbursements, and the employer's contributions — with net pay and the employer's cost.
	 */
	import { bolt } from '$bolt';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { live } from '../../../../lib/ui/state/live.svelte.js';
	import {
		formatCalendarDate,
		formatNumeric
	} from '../../../../lib/ui/format/display_formatters.js';
	import { moneyNumber } from '../../../../lib/payroll_engine/foundation.js';
	import { Schema } from 'effect';

	let { view }: { view: RecordView<'payslip'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const run = live(() =>
		record == null
			? null
			: bolt.get('payroll_run', record.payroll_run_id, {
					period: true,
					kind: true,
					company_id: { select: { name: true } }
				})
	);
	const employment = live(() =>
		record == null
			? null
			: bolt.get('employment_contract', record.employment_id, {
					employee_number: true,
					employee_id: { select: { name: true } }
				})
	);

	type Row = {
		readonly key: string;
		readonly label: string;
		readonly detail: string;
		readonly amount: number;
	};
	type Section = {
		readonly key: string;
		readonly title: string;
		readonly rows: readonly Row[];
		readonly total?: { label: string; amount: number };
	};
	const BaseLine = Schema.Struct({
		component_code: Schema.String,
		label: Schema.optional(Schema.String),
		amount: Schema.Number,
		quantity: Schema.optional(Schema.Number),
		rate: Schema.optional(Schema.Number)
	});
	const AdjustmentLine = Schema.Struct({
		source_id: Schema.String,
		component_code: Schema.String,
		label: Schema.optional(Schema.String),
		destination: Schema.optional(Schema.String),
		amount: Schema.Number
	});
	const StatutoryLine = Schema.Struct({
		scheme_code: Schema.String,
		base_amount: Schema.Number,
		employee_amount: Schema.Number,
		employer_amount: Schema.Number
	});
	type Base = Schema.Schema.Type<typeof BaseLine>;
	type Adjustment = Schema.Schema.Type<typeof AdjustmentLine>;
	type Statutory = Schema.Schema.Type<typeof StatutoryLine>;
	const BaseArray = Schema.Array(BaseLine);
	const AdjustmentArray = Schema.Array(AdjustmentLine);
	const StatutoryArray = Schema.Array(StatutoryLine);
	const baseLines = (value: unknown): readonly Base[] => (Schema.is(BaseArray)(value) ? value : []);
	const adjustmentLines = (value: unknown): readonly Adjustment[] =>
		Schema.is(AdjustmentArray)(value) ? value : [];
	const statutoryLines = (value: unknown): readonly Statutory[] =>
		Schema.is(StatutoryArray)(value) ? value : [];
	const figure = (amount: number) =>
		amount < 0 ? `−${formatNumeric(-amount)}` : formatNumeric(amount);
	/** A settled column as a figure; an unsettled one reads as an em dash, never a refusal. */
	const settled = (value: unknown): string => {
		const amount = moneyNumber(value);
		return amount == null ? '—' : figure(amount);
	};

	const sections = $derived.by((): Section[] => {
		if (record == null) return [];
		const base = baseLines(record.base);
		const adjustments = adjustmentLines(record.adjustments);
		const statutory = statutoryLines(record.statutory);
		const pay = adjustments.filter((line) => line.destination !== 'NET');
		const net = adjustments.filter((line) => line.destination === 'NET');
		const on = (amount: number) => `${bolt.t('component.payslip_on')} ${formatNumeric(amount)}`;
		const earnings: Row[] = [
			...base.map((line, i) => ({
				key: `base-${i}`,
				label: line.label ?? line.component_code,
				detail:
					line.quantity != null && line.rate != null && line.component_code !== 'BASIC'
						? `${formatNumeric(line.quantity)} × ${formatNumeric(line.rate)}`
						: '',
				amount: line.amount
			})),
			...pay.map((line) => ({
				key: line.source_id,
				label: line.label ?? line.component_code,
				detail: '',
				amount: line.amount
			}))
		];
		const deductions: Row[] = [
			...statutory
				.filter((line) => line.employee_amount !== 0)
				.map((line) => ({
					key: `ee-${line.scheme_code}`,
					label: line.scheme_code,
					detail: on(line.base_amount),
					amount: -line.employee_amount
				})),
			...net
				.filter((line) => line.amount < 0)
				.map((line) => ({
					key: line.source_id,
					label: line.label ?? line.component_code,
					detail: '',
					amount: line.amount
				}))
		];
		const reimbursements: Row[] = net
			.filter((line) => line.amount > 0)
			.map((line) => ({
				key: line.source_id,
				label: line.label ?? line.component_code,
				detail: '',
				amount: line.amount
			}));
		const employer: Row[] = statutory
			.filter((line) => line.employer_amount !== 0)
			.map((line) => ({
				key: `er-${line.scheme_code}`,
				label: line.scheme_code,
				detail: on(line.base_amount),
				amount: line.employer_amount
			}));
		return [
			{
				key: 'earnings',
				title: bolt.t('component.payslip_earnings'),
				rows: earnings,
				total: {
					label: bolt.t('component.payslip_gross_pay'),
					amount: moneyNumber(record.gross) ?? 0
				}
			},
			{
				key: 'deductions',
				title: bolt.t('component.payslip_deductions'),
				rows: deductions,
				total: {
					label: bolt.t('component.payslip_total_deductions'),
					amount: -(moneyNumber(record.total_deductions) ?? 0)
				}
			},
			...(reimbursements.length === 0
				? []
				: [
						{
							key: 'reimbursements',
							title: bolt.t('component.payslip_reimbursements'),
							rows: reimbursements
						}
					]),
			...(employer.length === 0
				? []
				: [
						{
							key: 'employer',
							title: bolt.t('component.payslip_employer_contributions'),
							rows: employer,
							total: {
								label: bolt.t('component.payslip_employer_total'),
								amount: employer.reduce((a, r) => a + r.amount, 0)
							}
						}
					])
		];
	});

	const header = $derived([
		[bolt.t('component.payslip_employer'), run.current?.company_id?.name],
		[bolt.t('component.employee'), employment.current?.employee_id?.name],
		[bolt.t('component.employee_number'), employment.current?.employee_number],
		[bolt.t('app.payroll.period'), run.current?.period],
		[bolt.t('app.payroll.kind'), run.current?.kind],
		[
			bolt.t('app.payroll.actual_payment_date'),
			record?.paid_at == null ? null : formatCalendarDate(String(record.paid_at).slice(0, 10))
		]
	] as const);
</script>

<RecordShell of="payslip" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	{#if record}
		<Stack gap="lg" shrink={false}>
			<Grid
				as="dl"
				gap="sm"
				minimum="compact"
				class="text-sm"
				aria-label={bolt.t('component.payslip')}
			>
				{#each header as [label, value] (label)}
					<Stack gap="none">
						<dt class="text-meta">{label}</dt>
						<dd class="font-medium">{value ?? '—'}</dd>
					</Stack>
				{/each}
			</Grid>
			{#if record.status !== 'PAID'}
				<Stack
					as="section"
					gap="sm"
					shrink={false}
					aria-label={bolt.t('app.payroll.payslip_payment')}
				>
					<h2 class="text-heading">{bolt.t('app.payroll.payslip_payment')}</h2>
					<p class="text-sm text-muted-foreground">{bolt.t('app.payroll.payslip_payment_help')}</p>
					<Form
						class="h-auto! shrink-0"
						of="payslip"
						mode="update"
						id={record.id}
						record={view.mode === 'update' ? view.record : null}
						fields={['status', 'paid_at']}
						submit={bolt.t('app.payroll.save_payment')}
					>
						<Grid gap="sm" minimum="compact">
							<Field name="status" label={bolt.t('component.status')} />
							<Field name="paid_at" label={bolt.t('app.payroll.actual_payment_date')} />
						</Grid>
					</Form>
				</Stack>
			{/if}
			<table class="w-full text-sm tabular-nums" aria-label={bolt.t('component.payslip_statement')}>
				<thead>
					<tr class="text-meta border-b border-border text-left">
						<th class="py-1 font-normal">{bolt.t('component.breakdown_item')}</th>
						<th class="py-1 pr-3 text-right font-normal">{bolt.t('component.breakdown_basis')}</th>
						<th class="py-1 pr-1 text-right font-normal">{record.currency}</th>
					</tr>
				</thead>
				{#each sections as section (section.key)}
					<tbody data-payslip-section={section.key}>
						<tr
							><th colspan="3" class="text-overline pt-4 pb-1 text-left text-muted-foreground"
								>{section.title}</th
							></tr
						>
						{#each section.rows as row (row.key)}
							<tr class="border-t border-border/60 align-baseline" data-payslip-line={row.key}>
								<td class="py-1 pr-3 pl-4">{row.label}</td>
								<td class="py-1 pr-3 text-right text-muted-foreground">{row.detail}</td>
								<td class="py-1 pr-1 text-right">{figure(row.amount)}</td>
							</tr>
						{/each}
						{#if section.total}
							<tr class="border-t border-border font-medium">
								<td class="py-1 pr-3" colspan="2">{section.total.label}</td>
								<td class="py-1 pr-1 text-right">{figure(section.total.amount)}</td>
							</tr>
						{/if}
					</tbody>
				{/each}
				<tbody data-payslip-section="totals">
					<tr><td colspan="3" class="pt-4"></td></tr>
					<tr class="border-t-2 border-foreground/20">
						<td class="py-1.5 pr-3 text-heading" colspan="2"
							>{bolt.t('component.payslip_net_pay')}</td
						>
						<td class="py-1.5 pr-1 text-right text-heading">{settled(record.net)}</td>
					</tr>
					<tr class="text-muted-foreground">
						<td class="py-1 pr-3" colspan="2">{bolt.t('component.payslip_employer_cost_total')}</td>
						<td class="py-1 pr-1 text-right">{settled(record.employer_cost)}</td>
					</tr>
				</tbody>
			</table>
		</Stack>
	{/if}
</RecordShell>
