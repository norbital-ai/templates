<script lang="ts">
	/**
	 * One payslip as a statement: who, which run, its payment state, and every line the build wrote — earnings
	 * (contract lines and pay entries), deductions (the employee's statutory share and recoveries from net),
	 * reimbursements, and the employer's contributions — with net pay and the employer's cost.
	 */
	import { bolt } from '$bolt';
	import { enumText, Field, Form, RecordShell, useBolt, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/format/display_formatters.js';
	import { schemeLabel, schemeRank } from '../../../lib/payroll_engine/salary_report.js';
	import { versionMoney } from '../../../lib/ui/format/version_money.svelte.js';
	import type { Decimal } from '@norbital-ai/std/decimal';

	let { view }: { view: RecordView<'payslip'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const money = versionMoney(() => (record == null ? null : { run: record.payroll_run_id }));
	const held = $derived.by(() =>
		record == null
			? null
			: bolt.query({
					payroll_run: {
						where: { id: { eq: record.payroll_run_id } },
						fields: ['period', 'kind', 'settings_id', 'company_id'],
						limit: 1
					},
					'payroll_run.company_id': { fields: ['name'] },
					employment_contract: {
						where: { id: { eq: record.employment_id } },
						fields: ['employee_number', 'employee_id'],
						limit: 1
					},
					'employment_contract.employee_id': { fields: ['name'] }
				})
	);
	const run = $derived(held?.current?.payroll_run.rows[0]);
	const employment = $derived(held?.current?.employment_contract.rows[0]);
	const schemes = $derived.by(() =>
		run == null
			? null
			: bolt.query({
					statutory_contribution_catalog: {
						where: { settings_id: { eq: run.settings_id } },
						fields: ['code', 'label', 'display_order']
					}
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
	const ui = useBolt();
	/** A line's own label; a label that is still its component code (no catalogue name) reads as words. */
	const named = (line: {
		readonly component_code: string;
		readonly label?: string | null | undefined;
	}) =>
		line.label != null && line.label !== '' && line.label !== line.component_code
			? line.label
			: enumText(line.component_code);
	const figure = (amount: number) => (amount < 0 ? `−${money(-amount)}` : money(amount));
	/** A settled column as a figure; an unsettled one reads as an em dash, never a refusal. */
	const settled = (value: Decimal | null | undefined): string =>
		value == null ? '—' : figure(value.toNumber());

	const sections = $derived.by((): Section[] => {
		if (record == null) return [];
		const base = record.base ?? [];
		const adjustments = record.adjustments ?? [];
		const catalogue = schemes?.current?.statutory_contribution_catalog.rows ?? [];
		const statutory = (record.statutory ?? []).toSorted(
			(a, b) => schemeRank(catalogue, a.scheme_code) - schemeRank(catalogue, b.scheme_code)
		);
		const pay = adjustments.filter((line) => line.destination !== 'NET');
		const net = adjustments.filter((line) => line.destination === 'NET');
		const on = (amount: number) => `${bolt.t('component.payslip_on')} ${money(amount)}`;
		const earnings: Row[] = [
			...base.map((line, i) => ({
				key: `base-${i}`,
				label: named(line),
				detail:
					line.quantity != null && line.rate != null && line.quantity !== 1
						? `${formatNumeric(line.quantity)} × ${formatNumeric(line.rate)}`
						: '',
				amount: line.amount
			})),
			...pay.map((line) => ({
				key: line.source_id,
				label: named(line),
				detail: '',
				amount: line.amount
			}))
		];
		const deductions: Row[] = [
			...statutory
				.filter((line) => line.employee_amount !== 0)
				.map((line) => ({
					key: `ee-${line.scheme_code}`,
					label: schemeLabel(catalogue, line.scheme_code),
					detail: on(line.charged_base ?? line.base_amount),
					amount: -line.employee_amount
				})),
			...net
				.filter((line) => line.amount < 0)
				.map((line) => ({
					key: line.source_id,
					label: named(line),
					detail: '',
					amount: line.amount
				}))
		];
		const reimbursements: Row[] = net
			.filter((line) => line.amount > 0)
			.map((line) => ({
				key: line.source_id,
				label: named(line),
				detail: '',
				amount: line.amount
			}));
		const employer: Row[] = statutory
			.filter((line) => line.employer_amount !== 0)
			.map((line) => ({
				key: `er-${line.scheme_code}`,
				label: schemeLabel(catalogue, line.scheme_code),
				detail: on(line.charged_base ?? line.base_amount),
				amount: line.employer_amount
			}));
		return [
			{
				key: 'earnings',
				title: bolt.t('component.payslip_earnings'),
				rows: earnings,
				total: {
					label: bolt.t('component.payslip_gross_pay'),
					amount: record.gross.toNumber()
				}
			},
			{
				key: 'deductions',
				title: bolt.t('component.payslip_deductions'),
				rows: deductions,
				total: {
					label: bolt.t('component.payslip_total_deductions'),
					amount: -record.total_deductions.toNumber()
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
		[bolt.t('component.payslip_employer'), run?.company_id?.name],
		[bolt.t('component.employee'), employment?.employee_id?.name],
		[bolt.t('component.employee_number'), employment?.employee_number],
		[bolt.t('app.payroll.period'), run?.period],
		[
			bolt.t('app.payroll.kind'),
			run?.kind == null
				? null
				: enumText(run.kind, {
						t: (key) => ui.t(key),
						model: 'payroll_run',
						field: 'kind'
					})
		],
		[
			bolt.t('app.payroll.actual_payment_date'),
			record?.paid_at == null ? null : formatCalendarDate(String(record.paid_at).slice(0, 10))
		]
	] as const);
</script>

<RecordShell of="payslip" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	{#if record}
		<Stack gap="lg">
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
					<tr class="text-muted-foreground">
						<td class="py-1 pr-3" colspan="2">{bolt.t('app.payroll.bank_charges')}</td>
						<td class="py-1 pr-1 text-right">
							{record.bank_charges == null
								? bolt.t('app.payroll.bank_charges_unknown')
								: settled(record.bank_charges)}
						</td>
					</tr>
				</tbody>
			</table>
			{#if record.status !== 'PAID'}
				<Stack as="section" gap="sm" aria-label={bolt.t('app.payroll.payslip_payment')}>
					<h2 class="text-heading">{bolt.t('app.payroll.payslip_payment')}</h2>
					<p class="text-sm text-muted-foreground">{bolt.t('app.payroll.payslip_payment_help')}</p>
					<Form
						class="h-auto! shrink-0"
						of="payslip"
						mode="update"
						id={record.id}
						record={view.mode !== 'create' ? view.record : null}
						fields={['bank_charges', 'status', 'paid_at']}
						submit={bolt.t('app.payroll.save_payment')}
					>
						<Grid gap="sm" minimum="compact">
							<Field name="bank_charges" label={bolt.t('app.payroll.bank_charges')} />
							<Field name="status" label={bolt.t('component.status')} />
							<Field name="paid_at" label={bolt.t('app.payroll.actual_payment_date')} />
						</Grid>
						<p class="text-sm text-muted-foreground">
							{bolt.t('app.payroll.bank_charges_help', { currency: record.currency })}
						</p>
					</Form>
				</Stack>
			{/if}
		</Stack>
	{/if}
</RecordShell>
