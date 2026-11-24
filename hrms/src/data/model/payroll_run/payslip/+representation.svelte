<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Schema } from 'effect';
	import { enum_text, format, Icon, RecordShell, Tooltip, type RecordView } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { emptyPayslipBreakdown, PayslipBreakdown } from '../service/payslip_breakdown.js';
	import { RECOVERY } from '../service/history_slice.js';
	import { pageLaws } from '../../../../lib/ui/law.svelte.js';
	import { moneyKind } from '../../../../lib/ui/format/money_kind.js';

	const FAMILIES = [
		'allowance_catalog',
		'leave_catalog',
		'claim_catalog',
		'adhoc_catalog',
		'loan_catalog',
		'overtime_catalog',
		'statutory_contribution_catalog'
	] as const;

	type Line = PayslipBreakdown['lines'][number];

	const isBasic = (line: Line) => line.source === 'employment' && line.code === 'BASIC';
	const isBaseAdjustment = (line: Line) =>
		(line.source === 'employment' && line.code === 'PRORATED') ||
		(line.source === 'leave_catalog_entry' &&
			line.direction === 'DEDUCT' &&
			line.subtotal === 'PAID_BASIC');
	const signedValue = (line: Line) => (line.direction === 'DEDUCT' ? -line.amount : line.amount);

	let { view, ctx }: { view: RecordView<'payslip'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const breakdown = $derived.by(() => {
		if (record === null) return emptyPayslipBreakdown;
		try {
			return Schema.decodeUnknownSync(PayslipBreakdown)(record.breakdown);
		} catch {
			return emptyPayslipBreakdown;
		}
	});

	const currentEmployee = $derived(
		breakdown.lines.filter(
			(line) => line.party === 'EMPLOYEE' && line.period === undefined && line.code !== RECOVERY
		)
	);
	const basicLines = $derived(currentEmployee.filter(isBasic));
	const baseAdjustments = $derived(currentEmployee.filter(isBaseAdjustment));
	const additionLines = $derived(
		currentEmployee.filter(
			(line) => !isBasic(line) && !isBaseAdjustment(line) && line.direction === 'ADD'
		)
	);
	const deductionLines = $derived(
		currentEmployee.filter(
			(line) => !isBasic(line) && !isBaseAdjustment(line) && line.direction === 'DEDUCT'
		)
	);
	const adjustments = $derived(
		breakdown.lines.filter((line) => line.party === 'EMPLOYEE' && line.period !== undefined)
	);
	const recovery = $derived(
		breakdown.lines.filter(
			(line) => line.party === 'EMPLOYEE' && line.period === undefined && line.code === RECOVERY
		)
	);
	const employer = $derived(breakdown.lines.filter((line) => line.party === 'EMPLOYER'));

	const paidBasic = $derived(
		[...basicLines, ...baseAdjustments].reduce((total, line) => total + signedValue(line), 0)
	);
	const grossPay = $derived(
		paidBasic + additionLines.reduce((total, line) => total + line.amount, 0)
	);
	const deductionsTotal = $derived(deductionLines.reduce((total, line) => total + line.amount, 0));
	const adjustmentsTotal = $derived(
		adjustments.reduce((total, line) => total + signedValue(line), 0)
	);
	const hasEarnings = $derived(
		basicLines.length > 0 || baseAdjustments.length > 0 || additionLines.length > 0
	);

	// What each line is, in the words of the catalogue row that posted it, under the law of the payslip's company on
	// its run's pay date.
	const owner = $derived(
		record === null
			? null
			: ctx.query({
					payslip: {
						where: { id: { eq: record.id } },
						fields: ['entity_id', 'payroll_run_id'],
						limit: 1,
						entity_id: { fields: ['settings_code'] },
						payroll_run_id: { fields: ['kind', 'pay_date', 'salary_coverage'] }
					}
				})
	);
	const slip = $derived(owner?.current?.payslip.rows[0]);
	const laws = pageLaws(ctx, () => (slip?.entity_id == null ? [] : [slip.entity_id.settings_code]));
	const law = $derived(
		slip?.entity_id == null || slip.payroll_run_id == null
			? undefined
			: laws.on(slip.entity_id.settings_code, String(slip.payroll_run_id.pay_date))
	);
	const currency = $derived(
		typeof law?.settings.currency === 'string' && law.settings.currency.trim() !== ''
			? law.settings.currency
			: undefined
	);
	const scale = $derived(moneyKind(currency).scale);
	const descriptions = $derived(
		new Map<string, string>(
			FAMILIES.flatMap((family) =>
				(law?.rows[family] ?? []).flatMap((row) =>
					typeof row.description === 'string' && row.description.trim() !== ''
						? [[`${family}:${String(row.code)}`, row.description] as const]
						: []
				)
			)
		)
	);
	const cashOutByCode = $derived(
		new Map<string, number>(
			(breakdown.cash_out ?? []).map((item) => [item.code, item.amount] as const)
		)
	);

	const contextLine = $derived.by(() => {
		const run = slip?.payroll_run_id;
		if (run == null) return '';
		const parts: string[] = [];
		const coverage = format({ kind: 'period', of: 'date' }, run.salary_coverage, {
			locale: ctx.locale
		});
		if (coverage !== '') parts.push(coverage);
		const payDate = format({ kind: 'date' }, run.pay_date, { locale: ctx.locale });
		if (payDate !== '') parts.push(ctx.t('app.payroll.pay_date', { date: payDate }));
		if (run.kind === 'OFF_CYCLE') parts.push(ctx.t('app.payroll.off_cycle'));
		return parts.join(' · ');
	});

	const cleanDecimal = (value: Parameters<typeof format>[1]) => {
		const numeric =
			typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
		return Number.isFinite(numeric)
			? (Math.abs(numeric) < 1e-12 ? 0 : numeric).toFixed(scale)
			: value;
	};
	/** Plain right-aligned statement figure (currency sits in the header and bottom line). */
	const figure = (value: Parameters<typeof format>[1]) =>
		format({ kind: 'money' }, cleanDecimal(value), { locale: ctx.locale });
	/** Accounting parentheses for deductions and contra-earnings. */
	const negative = (value: number) => `(${figure(Math.abs(value))})`;
	const signedFigure = (value: number) => (value < -1e-12 ? negative(value) : figure(value));
	const totalMoney = (value: Parameters<typeof format>[1]) =>
		format(
			{ kind: 'money' },
			cleanDecimal(value),
			currency === undefined ? { locale: ctx.locale } : { locale: ctx.locale, currency }
		);

	/**
	 * A line's catalogue family: an entry (or a loan repayment) belongs to the catalogue it was raised on; a scheme's
	 * employer share is `<code>_EMPLOYER`.
	 */
	const describe = (line: Line) =>
		descriptions.get(
			`${line.source.replace(/_entry(_repayment)?$/, '')}:${line.party === 'EMPLOYER' ? line.code.replace(/_EMPLOYER$/, '') : line.code}`
		);

	const lineLabel = (line: Line): string => {
		if (line.code === 'PRORATED' && line.source === 'employment')
			return ctx.t('app.payroll.line.proration');
		if (line.code === RECOVERY) return ctx.t('app.payroll.line.recovery_carried');
		if (line.source === 'leave_catalog_entry' && line.code === 'NPL')
			return ctx.t('app.payroll.line.npl');
		if (line.source === 'statutory_contribution_catalog')
			return line.code.replace(/_EMPLOYER$/, '');
		if (line.label !== '' && line.label !== line.code) return line.label;
		if (/^[A-Z0-9]{1,4}$/.test(line.code)) return line.code;
		return enum_text(line.code);
	};

	const lineHint = (line: Line): string | undefined => {
		if (line.code === 'PRORATED' && line.source === 'employment')
			return ctx.t('app.payroll.line.proration_hint');
		if (line.code === RECOVERY) return ctx.t('app.payroll.line.recovery_carried_hint');
		return describe(line);
	};

	const measure = (line: Line) => {
		if (line.quantity === undefined || line.unit === undefined || line.unit === 'MONEY') return '';
		const count = new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 4 }).format(
			line.quantity
		);
		if (line.unit === 'DAY')
			return ctx.t(
				line.quantity === 1 ? 'app.payroll.unit.day_one' : 'app.payroll.unit.day_other',
				{
					count
				}
			);
		if (line.unit === 'HOUR')
			return ctx.t(
				line.quantity === 1 ? 'app.payroll.unit.hour_one' : 'app.payroll.unit.hour_other',
				{ count }
			);
		return `${count} ${line.unit.toLowerCase()}`;
	};

	const lineContext = (line: Line): string => {
		if (line.period !== undefined) return '';
		if (line.source === 'leave_catalog_entry') {
			const settled = cashOutByCode.get(line.code);
			if (line.direction === 'ADD')
				return settled !== undefined && settled > 0
					? ctx.t('app.payroll.line.exit_encashment')
					: ctx.t('app.payroll.line.leave_encashment');
			if (settled !== undefined && settled < 0) return ctx.t('app.payroll.line.overtaken_leave');
		}
		if (line.source === 'statutory_contribution_catalog' && line.party === 'EMPLOYEE')
			if (line.direction === 'ADD') return ctx.t('app.payroll.line.refund');
		return '';
	};

	const lineNote = (line: Line) =>
		[measure(line), lineContext(line), line.period].filter(Boolean).join(' · ');
</script>

{#snippet row(
	label: string,
	hint: string | undefined,
	value: string,
	options: {
		note?: string;
		indent?: boolean;
		muted?: boolean;
		subtotal?: boolean;
	} = {}
)}
	<Inline
		as="li"
		justify="between"
		align="start"
		gap="md"
		class={[
			'text-sm',
			options.subtotal ? 'mt-1 border-t py-2 font-medium' : 'py-1.5',
			options.indent ? 'pl-4' : ''
		]
			.filter(Boolean)
			.join(' ')}
	>
		<Stack gap="none">
			<Inline gap="xs">
				<span
					class={[
						'[overflow-wrap:anywhere]',
						options.muted && !options.subtotal ? 'text-muted-foreground' : ''
					]
						.filter(Boolean)
						.join(' ')}>{label}</span
				>
				{#if hint !== undefined}<Tooltip text={hint}>
						{#snippet trigger({ props })}
							<button
								{...props}
								type="button"
								aria-label={hint}
								class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
								><Icon name="lucide:info" class="size-3.5" /></button
							>
						{/snippet}
					</Tooltip>{/if}
			</Inline>
			{#if options.note}<span class="text-xs text-muted-foreground">{options.note}</span>{/if}
		</Stack>
		<span
			class={[
				'shrink-0 tabular-nums',
				options.muted && !options.subtotal ? 'text-muted-foreground' : ''
			]
				.filter(Boolean)
				.join(' ')}>{value}</span
		>
	</Inline>
{/snippet}

{#snippet heading(title: string)}
	<h3 class="border-b pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
		{title}
	</h3>
{/snippet}

<RecordShell
	{ctx}
	of="payslip"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record !== null}
		<Stack gap="lg">
			{#if contextLine !== '' || currency !== undefined}
				<Inline justify="between" align="center" gap="md" class="text-xs text-muted-foreground">
					<span>{contextLine}</span>
					{#if currency !== undefined}
						<span class="shrink-0 font-medium tracking-wider uppercase">{currency}</span>
					{/if}
				</Inline>
			{/if}

			{#if hasEarnings}
				<Stack as="section" gap="none">
					{@render heading(ctx.t('app.payroll.earnings'))}
					<Stack as="ul" gap="none">
						{#each basicLines as line}
							{@render row(lineLabel(line), lineHint(line), figure(line.amount), {
								note: lineNote(line)
							})}
						{/each}
						{#each baseAdjustments as line}
							{@render row(
								line.direction === 'DEDUCT'
									? ctx.t('app.payroll.less', { label: lineLabel(line) })
									: lineLabel(line),
								lineHint(line),
								signedFigure(signedValue(line)),
								{
									note: lineNote(line),
									indent: basicLines.length > 0,
									muted: line.direction === 'DEDUCT'
								}
							)}
						{/each}
						{#if baseAdjustments.length > 0 && additionLines.length > 0}
							{@render row(
								ctx.t('app.payroll.paid_basic'),
								ctx.t('checkpoint.PAID_BASIC'),
								signedFigure(paidBasic),
								{ subtotal: true }
							)}
						{/if}
						{#each additionLines as line}
							{@render row(lineLabel(line), lineHint(line), figure(line.amount), {
								note: lineNote(line)
							})}
						{/each}
						{@render row(
							ctx.t('app.payroll.gross_pay'),
							ctx.t('checkpoint.GROSS'),
							signedFigure(grossPay),
							{ subtotal: true }
						)}
					</Stack>
				</Stack>
			{/if}

			{#if deductionLines.length > 0}
				<Stack as="section" gap="none">
					{@render heading(ctx.t('app.payroll.deductions'))}
					<Stack as="ul" gap="none">
						{#each deductionLines as line}
							{@render row(lineLabel(line), lineHint(line), negative(line.amount), {
								note: lineNote(line),
								muted: true
							})}
						{/each}
						{@render row(
							ctx.t('app.payroll.total_deductions'),
							undefined,
							negative(deductionsTotal),
							{ subtotal: true }
						)}
					</Stack>
				</Stack>
			{/if}

			{#if adjustments.length > 0}
				<Stack as="section" gap="xs">
					{@render heading(ctx.t('app.payroll.adjustments_for_earlier_periods'))}
					<p class="text-xs text-muted-foreground">{ctx.t('app.payroll.adjustments_help')}</p>
					<Stack as="ul" gap="none">
						{#each adjustments as line}
							{@render row(lineLabel(line), lineHint(line), signedFigure(signedValue(line)), {
								note: lineNote(line),
								muted: line.direction === 'DEDUCT'
							})}
						{/each}
						{@render row(
							ctx.t('app.payroll.adjustments_total'),
							undefined,
							signedFigure(adjustmentsTotal),
							{ subtotal: true }
						)}
					</Stack>
				</Stack>
			{/if}

			{#if recovery.length > 0}
				<Stack as="ul" gap="none">
					{#each recovery as line}
						{@render row(lineLabel(line), lineHint(line), figure(line.amount), {
							note: lineNote(line)
						})}
					{/each}
				</Stack>
			{/if}

			<Inline
				justify="between"
				align="center"
				gap="md"
				class="border-t border-b-2 border-foreground/30 py-3 text-base font-medium"
			>
				<span>{ctx.t('app.payroll.net_pay')}</span>
				<span class="shrink-0 tabular-nums">{totalMoney(record.net_pay)}</span>
			</Inline>

			{#if employer.length > 0}
				<Stack as="section" gap="none" class="pt-2">
					{@render heading(ctx.t('app.payroll.employer_contributions'))}
					<Stack as="ul" gap="none">
						{#each employer as line}
							{@render row(lineLabel(line), lineHint(line), signedFigure(signedValue(line)), {
								note: lineNote(line),
								muted: line.direction === 'DEDUCT'
							})}
						{/each}
						{@render row(
							ctx.t('app.payroll.total_employer_contributions'),
							undefined,
							figure(record.employer_cost),
							{ subtotal: true }
						)}
					</Stack>
				</Stack>
			{/if}
		</Stack>
	{/if}
</RecordShell>
