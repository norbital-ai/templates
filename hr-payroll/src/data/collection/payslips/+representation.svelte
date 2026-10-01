<script lang="ts">
	/**
	 * One payslip as a statement table: a header (employer, employee, number, period, pay date,
	 * worksite), then Earnings → Gross, Deductions, Reimbursements → Net, Employer contributions →
	 * Employer cost. Every figure is read from the record, never recomputed; a line's working
	 * (proration, hours × rate) is a compact figure beside it, and its trace opens from `?`.
	 *
	 * BASE, PRORATION and STATUTORY are columns on the record; ADJUSTMENTS holds one row per
	 * captured input. Lines of one component at one rate collapse into one row whose entries unfold.
	 * Rows are keyed by name plus index: the engine can write two base lines under one code and two
	 * proration segments that share `term_key` and `from`.
	 */
	import { t, type MessageKey } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Field, Form, Icon } from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { decodeNumber, plain } from '../../../lib/wire.js';
	import { schemeLabel, bySchemeListing } from '../../../lib/payroll/scheme-label.js';
	import { readRange } from '../../../lib/payroll/run/effective.js';
	import { dateKey } from '../../../lib/iso-day.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { live, liveRows } from '../../../lib/ui/live.svelte.js';
	import InfoTip from '../../../lib/ui/InfoTip.svelte';
	import LineExplanation from '../../../lib/trace/LineExplanation.svelte';
	import type { TracedLine } from '../../../lib/trace/record.js';

	let { view }: { view: RecordView<'payslips'> } = $props();
	/** The stored row, its wire values plain. */
	const record = $derived(view.mode === 'update' ? plain(view.record) : null);

	const summary = live(() =>
		record == null
			? null
			: bolt.get('payslips', record.id, {
					employment_id: {
						select: { employee_number: true, employee_id: { select: { name: true } } }
					},
					payroll_run_id: {
						select: {
							period: true,
							pay_date: true,
							settings_id: true,
							company_id: { select: { name: true } }
						}
					}
				})
	);
	const employment = $derived(summary.current?.employment_id ?? null);
	const run = $derived(summary.current?.payroll_run_id ?? null);
	const terms = liveRows(() =>
		record == null
			? null
			: bolt.read('employment_terms', {
					where: { employment_id: { eq: record.employment_id }, approval_id: { isNull: true } },
					select: { effective_range: true, worksite_id: { select: { name: true } } },
					all: true
				})
	);
	/** The terms in force on the pay date: the latest revision starting on or before it. */
	const worksite = $derived.by(() => {
		const payDate = run?.pay_date == null ? null : dateKey(run.pay_date);
		const dated = (terms.current ?? [])
			.map((row) => ({ row, start: dateKey(readRange(row.effective_range)?.start) }))
			.toSorted((a, b) => a.start.localeCompare(b.start));
		const current =
			dated.filter((entry) => payDate == null || entry.start <= payDate).at(-1) ?? dated.at(-1);
		return current?.row.worksite_id?.name ?? null;
	});
	/** Allowance names for the contracted lines; an adjustment carries its own frozen label. */
	const allowances = liveRows(() =>
		run?.settings_id == null
			? null
			: bolt.read('allowance_catalogue', {
					where: { settings_id: { eq: run.settings_id } },
					select: { code: true, name: true },
					all: true
				})
	);
	const allowanceName = $derived(
		new Map((allowances.current ?? []).map((row) => [row.code, row.name ?? row.code]))
	);

	const payableRows = liveRows(() =>
		record == null || record.payment_mode !== 'EVENT_LEDGER'
			? null
			: bolt.read('payable_tranches', {
					where: { settlement: { payslips: { eq: record.id } } },
					select: {
						gross_amount: true,
						payment_allocations: { select: { gross_amount: true }, all: true }
					},
					all: true
				})
	);
	const paymentProgress = $derived.by(() => {
		const rows = payableRows.current ?? [];
		const due = rows.reduce((sum, row) => sum + decodeNumber(row.gross_amount), 0);
		const allocated = rows.reduce(
			(sum, row) =>
				sum +
				row.payment_allocations.reduce(
					(part, allocation) => part + decodeNumber(allocation.gross_amount),
					0
				),
			0
		);
		return {
			due,
			allocated,
			remaining: Math.max(0, due - allocated),
			hasTranches: rows.length > 0
		};
	});

	const base = $derived(record?.base ?? []);
	const proration = $derived(record?.proration ?? []);
	const statutory = $derived((record?.statutory ?? []).toSorted(bySchemeListing));
	const adjustments = $derived(
		(record?.adjustments ?? []).map((adjustment, index) => ({ ...adjustment, id: String(index) }))
	);
	type Adjustment = (typeof adjustments)[number];

	/** Engine-reserved line codes, printed by name; every other code is a catalogue's. */
	const RESERVED: Readonly<Record<string, MessageKey>> = {
		BASIC: 'component.payslip_line_basic',
		OVERTIME: 'component.payslip_line_overtime',
		INCENTIVE: 'component.payslip_line_incentive',
		ABSENCE: 'component.payslip_line_absence'
	};
	const codeName = (code: string) =>
		RESERVED[code] == null ? (allowanceName.get(code) ?? code) : t(RESERVED[code]!);
	/** An adjustment by its frozen label; a reserved line prefixes its band (`Overtime OT-1.5X`). */
	const adjustmentName = (adjustment: Adjustment) =>
		RESERVED[adjustment.component_code] == null
			? adjustment.label || adjustment.component_code
			: adjustment.label === '' || adjustment.label === adjustment.component_code
				? codeName(adjustment.component_code)
				: `${codeName(adjustment.component_code)} ${adjustment.label}`;

	/** The published configuration paths that price a line: its catalogue row, or the work rules that price a work day. */
	const CATALOGUE_OF: Readonly<Record<Adjustment['family'], readonly string[]>> = {
		CLAIM: ['claim_catalogue'],
		ADHOC: ['adhoc_catalogue'],
		LEAVE: ['leave_catalogue'],
		LOAN_REPAYMENT: ['loan_catalogue'],
		WORK_DAY: []
	};
	const configOf = (adjustment: Adjustment): readonly string[] =>
		adjustment.family === 'WORK_DAY'
			? ['work_rules.bands', 'work_rules.derived_lines']
			: CATALOGUE_OF[adjustment.family].map(
					(collection) => `${collection}:${adjustment.component_code}`
				);

	type Why = {
		readonly line: Omit<TracedLine, 'part' | 'employment_id'>;
		readonly config: readonly string[];
	};
	type Row = {
		readonly key: string;
		readonly label: string;
		readonly detail: string;
		/** Signed: what the line does to the employee's pay (or, employer rows, to the cost). */
		readonly amount: number;
		readonly why: Why | null;
		readonly entries: readonly Row[];
	};

	const QTY = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
	const quantityRate = (quantity: unknown, rate: unknown) =>
		rate == null || quantity == null
			? ''
			: `${QTY.format(decodeNumber(quantity))} × ${formatNumeric(rate)}`;
	const adjustmentWhy = (adjustment: Adjustment): Why => ({
		line: { kind: 'ADJUSTMENT', code: adjustment.component_code, source_id: adjustment.source_id },
		config: configOf(adjustment)
	});

	/** A rate's identity for grouping: twelve significant digits, so float noise is one rate. */
	const rateKey = (rate: unknown): string => {
		const value = decodeNumber(rate);
		return rate == null ? '' : Number.isFinite(value) ? value.toPrecision(12) : String(rate);
	};
	/** One row per component and rate; the entries behind a repeated one unfold under it. */
	function adjustmentRows(bucket: Adjustment['bucket'], sign: 1 | -1): Row[] {
		const groups = Map.groupBy(
			adjustments.filter((adjustment) => adjustment.bucket === bucket),
			(adjustment) => [adjustmentName(adjustment), rateKey(adjustment.rate)].join('\u0000')
		);
		return [...groups].map(([key, entries]) => {
			const first = entries[0]!;
			const quantity = entries.reduce((sum, entry) => sum + (decodeNumber(entry.quantity) || 0), 0);
			return {
				key,
				label: adjustmentName(first),
				detail: quantityRate(first.quantity == null ? null : quantity, first.rate),
				amount: sign * entries.reduce((sum, entry) => sum + (decodeNumber(entry.amount) || 0), 0),
				why: entries.length === 1 ? adjustmentWhy(first) : null,
				entries:
					entries.length === 1
						? []
						: entries.map((entry, index) => ({
								key: `${key}:${entry.id}`,
								label: `${index + 1}`,
								detail: quantityRate(entry.quantity, entry.rate),
								amount: sign * decodeNumber(entry.amount),
								why: adjustmentWhy(entry),
								entries: []
							}))
			};
		});
	}

	/** A contracted line with its proration as figures: `500.00 × 16/31`, segments added. */
	const baseRows = $derived(
		base.map((entry, index): Row => {
			const segments = proration.filter(
				(segment) => segment.component_code === entry.component_code
			);
			const prorated = segments.some((segment) => segment.days !== segment.denominator);
			return {
				key: `base:${entry.component_code}:${index}`,
				label: codeName(entry.component_code),
				detail: prorated
					? segments
							.map(
								(segment) =>
									`${formatNumeric(segment.contract_amount)} × ${QTY.format(segment.days)}/${QTY.format(segment.denominator)}`
							)
							.join(' + ')
					: '',
				amount: decodeNumber(entry.amount),
				why: null,
				entries: []
			};
		})
	);
	const statutoryRows = (share: 'employee' | 'employer'): Row[] =>
		statutory.flatMap((charge, index) => {
			const amount = decodeNumber(
				share === 'employee' ? charge.employee_amount : charge.employer_amount
			);
			// a scheme charged to nobody on this side prints nothing; an employee-only scheme (a tax)
			// assessed at zero still prints its 0.00
			const hasEmployerShare = decodeNumber(charge.employer_amount) !== 0;
			return amount === 0 && (share === 'employer' || hasEmployerShare)
				? []
				: [
						{
							key: `${charge.scheme_code}:${share}:${index}`,
							label: schemeLabel(charge),
							detail: `${t('component.payslip_on')} ${formatNumeric(charge.base_amount)}`,
							amount: share === 'employee' ? -amount : amount,
							why: {
								line: { kind: 'STATUTORY', code: charge.scheme_code },
								config: [`statutory_contributions:${charge.scheme_code}`]
							},
							entries: []
						}
					];
		});

	type Section = {
		readonly key: string;
		readonly title: string;
		readonly rows: readonly Row[];
		readonly total?: { readonly label: string; readonly amount: number } | undefined;
	};
	const sum = (rows: readonly Row[]) => rows.reduce((total, row) => total + row.amount, 0);
	const sections = $derived.by((): Section[] => {
		if (record == null) return [];
		const employer = [...statutoryRows('employer'), ...adjustmentRows('EMPLOYER_COST', 1)];
		const payments = adjustmentRows('NON_WAGE_PAYMENT', 1);
		const information = adjustmentRows('INFORMATION', 1);
		return [
			{
				key: 'earnings',
				title: t('component.payslip_earnings'),
				rows: [...baseRows, ...adjustmentRows('EARNING', 1), ...adjustmentRows('ABSENCE', -1)],
				total: { label: t('component.payslip_gross_pay'), amount: decodeNumber(record.gross) }
			},
			{
				key: 'deductions',
				title: t('component.payslip_deductions'),
				rows: [...statutoryRows('employee'), ...adjustmentRows('DEDUCTION', -1)],
				total: {
					label: t('component.payslip_total_deductions'),
					amount: -decodeNumber(record.total_deductions)
				}
			},
			...(payments.length === 0
				? []
				: [{ key: 'payments', title: t('component.payslip_reimbursements'), rows: payments }]),
			...(employer.length === 0
				? []
				: [
						{
							key: 'employer',
							title: t('component.payslip_employer_contributions'),
							rows: employer,
							total: { label: t('component.payslip_employer_total'), amount: sum(employer) }
						}
					]),
			...(information.length === 0
				? []
				: [{ key: 'information', title: t('component.payslip_information'), rows: information }])
		];
	});

	/** Money in the payslip's currency; a bad code prints the bare figure. */
	const moneyFormat = $derived.by(() => {
		try {
			return new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: record?.currency ?? 'USD',
				currencyDisplay: 'narrowSymbol'
			});
		} catch {
			return null;
		}
	});
	const money = (amount: number) => {
		const text = moneyFormat?.format(Math.abs(amount)) ?? formatNumeric(Math.abs(amount));
		return amount < 0 ? `−${text}` : text;
	};
	const figure = (amount: number) =>
		amount < 0 ? `−${formatNumeric(-amount)}` : formatNumeric(amount);

	const header = $derived([
		[t('component.payslip_employer'), run?.company_id?.name],
		[t('component.employee'), employment?.employee_id?.name],
		[t('component.employee_number'), employment?.employee_number],
		[t('app.payroll.period'), run?.period],
		[t('app.payroll.pay_date'), run?.pay_date == null ? null : formatCalendarDate(run.pay_date)],
		[t('component.payslip_worksite'), worksite]
	] as const);

	let open = $state(new Set<string>());
	const toggle = (key: string) => {
		const next = new Set(open);
		if (!next.delete(key)) next.add(key);
		open = next;
	};
</script>

{#snippet line(row: Row, nested: boolean)}
	<tr class="border-t border-border/60 align-baseline" data-payslip-line={row.key}>
		<td class="py-1 pr-3 {nested ? 'pl-10 text-muted-foreground' : 'pl-4'}">
			{#if row.entries.length > 0}
				<button
					type="button"
					class="text-left"
					aria-expanded={open.has(row.key)}
					onclick={() => toggle(row.key)}
				>
					<Inline as="span" gap="xs" align="center">
						<Icon
							name="lucide:chevron-right"
							class="size-3.5 shrink-0 text-muted-foreground transition-transform {open.has(row.key)
								? 'rotate-90'
								: ''}"
						/>
						{row.label}
						<span class="text-meta">×{row.entries.length}</span>
					</Inline>
				</button>
			{:else}
				{row.label}
			{/if}
		</td>
		<td class="py-1 pr-3 text-right text-muted-foreground">{row.detail}</td>
		<td class="py-1 pr-1 text-right">{figure(row.amount)}</td>
		<td class="w-7 py-0 text-right">
			{#if row.why && record}
				<LineExplanation
					config={row.why.config}
					payslipId={record.id}
					line={row.why.line}
					title={row.label}
				/>
			{/if}
		</td>
	</tr>
	{#if open.has(row.key)}
		{#each row.entries as entry (entry.key)}{@render line(entry, true)}{/each}
	{/if}
{/snippet}

<RecordShell of="payslips" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	{#if record}
		<Stack gap="lg">
			<Grid as="dl" gap="sm" minimum="compact" class="text-sm" aria-label={t('component.payslip')}>
				{#each header as [label, value] (label)}
					<Stack gap="none">
						<dt class="text-meta">{label}</dt>
						<dd class="font-medium">{value ?? '—'}</dd>
					</Stack>
				{/each}
			</Grid>
			<Stack as="section" gap="sm" aria-label={t('app.payroll.payslip_payment')}>
				<h2 class="text-heading">{t('app.payroll.payslip_payment')}</h2>
				{#if record.status === 'PAID'}
					<Grid as="dl" gap="sm" minimum="compact" class="text-sm">
						<Stack gap="none">
							<dt class="text-meta">{t('component.status')}</dt>
							<dd>{t('app.payroll.paid')}</dd>
						</Stack>
						<Stack gap="none">
							<dt class="text-meta">{t('app.payroll.actual_payment_date')}</dt>
							<dd class="tabular-nums">{formatCalendarDate(record.paid_at)}</dd>
						</Stack>
					</Grid>
				{:else if record.payment_mode === 'EVENT_LEDGER'}
					<p class="text-sm text-muted-foreground">{t('component.payment_use_events')}</p>
				{:else}
					<p class="text-sm text-muted-foreground">{t('app.payroll.payslip_payment_help')}</p>
					<Form
						of="payslips"
						mode="update"
						id={record.id}
						record={view.mode === 'update' ? view.record : null}
						submit={t('app.payroll.save_payment')}
					>
						<Grid gap="sm" minimum="compact">
							<Field name="status" label={t('component.status')} />
							<Field name="paid_at" label={t('app.payroll.actual_payment_date')} />
						</Grid>
					</Form>
				{/if}
			</Stack>

			{#if record.payment_mode === 'EVENT_LEDGER' && paymentProgress.hasTranches}
				<p class="text-meta tabular-nums">
					{t('component.payment_gross_allocated')}: {money(paymentProgress.allocated)} / {money(
						paymentProgress.due
					)} · {t('component.payment_gross_remaining')}: {money(paymentProgress.remaining)}
				</p>
			{/if}

			<table class="w-full text-sm tabular-nums" aria-label={t('component.payslip_statement')}>
				<thead>
					<tr class="text-meta border-b border-border text-left">
						<th class="py-1 font-normal"
							><Inline gap="xs" align="center"
								>{t('component.breakdown_item')}<InfoTip label={t('component.breakdown_item')}
									>{t('component.breakdown_item_help')}</InfoTip
								></Inline
							></th
						>
						<th class="py-1 pr-3 text-right font-normal"
							><Inline gap="xs" align="center"
								>{t('component.breakdown_basis')}<InfoTip label={t('component.breakdown_basis')}
									>{t('component.breakdown_basis_help')}</InfoTip
								></Inline
							></th
						>
						<th class="py-1 pr-1 text-right font-normal"
							><Inline gap="xs" align="center"
								>{record.currency}<InfoTip label={record.currency}
									>{t('component.breakdown_amount_help')}</InfoTip
								></Inline
							></th
						>
						<th class="w-7"></th>
					</tr>
				</thead>
				{#each sections as section (section.key)}
					<tbody data-payslip-section={section.key}>
						<tr>
							<th colspan="4" class="text-overline pt-4 pb-1 text-left text-muted-foreground"
								>{section.title}</th
							>
						</tr>
						{#each section.rows as row (row.key)}{@render line(row, false)}{/each}
						{#if section.total}
							<tr class="border-t border-border font-medium">
								<td class="py-1 pr-3" colspan="2">{section.total.label}</td>
								<td class="py-1 pr-1 text-right">{figure(section.total.amount)}</td>
								<td></td>
							</tr>
						{/if}
					</tbody>
				{/each}
				<tbody data-payslip-section="totals">
					<tr><td colspan="4" class="pt-4"></td></tr>
					<tr class="border-t-2 border-foreground/20">
						<td class="py-1.5 pr-3 text-heading" colspan="2">{t('component.payslip_net_pay')}</td>
						<td class="py-1.5 pr-1 text-right text-heading">{money(decodeNumber(record.net))}</td>
						<td></td>
					</tr>
					<tr class="text-muted-foreground">
						<td class="py-1 pr-3" colspan="2">{t('component.payslip_employer_cost_total')}</td>
						<td class="py-1 pr-1 text-right">{money(decodeNumber(record.employer_cost))}</td>
						<td></td>
					</tr>
				</tbody>
			</table>

			{#if decodeNumber(record.unfunded_contributions) > 0}
				<Stack as="section" gap="sm" class="border-t border-border pt-4">
					<Grid as="dl" gap="sm" minimum="compact" class="text-sm tabular-nums">
						<Stack gap="none">
							<dt class="text-meta">{t('component.unfunded_contributions')}</dt>
							<dd>{money(decodeNumber(record.unfunded_contributions))}</dd>
						</Stack>
						<Stack gap="none">
							<dt class="text-meta">{t('component.funding_outstanding')}</dt>
							<dd>
								{money(
									Math.max(
										0,
										decodeNumber(record.unfunded_contributions) -
											decodeNumber(record.funding_received)
									)
								)}
							</dd>
						</Stack>
					</Grid>
					<!-- A paid slip edits nothing (its state's `edit: 'none'`): the fields read locked. -->
					<Form
						of="payslips"
						mode="update"
						id={record.id}
						record={view.mode === 'update' ? view.record : null}
						submit={t('component.save_funding')}
					>
						<Grid gap="sm" minimum="compact">
							<Field name="funding_received" label={t('component.funding_received')} />
							<Field name="funding_received_on" label={t('component.funding_received_on')} />
							<Field name="funding_reference" label={t('component.funding_reference')} />
						</Grid>
					</Form>
				</Stack>
			{/if}
		</Stack>
	{/if}
</RecordShell>
