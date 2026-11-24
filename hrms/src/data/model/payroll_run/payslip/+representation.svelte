<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Schema } from 'effect';
	import {
		enum_text,
		format,
		Icon,
		RecordShell,
		Section,
		Tooltip,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
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

	const GUIDED_CHECKPOINTS = [
		'BASIC',
		'PRORATED',
		'PAID_BASIC',
		'ORDINARY_WAGES',
		'ADDITIONAL_WAGES',
		'GROSS',
		'FINAL_PAY',
		'RETIREMENT',
		'NET'
	] as const;

	const CORE_CHECKPOINTS = new Set(['ORDINARY_WAGES', 'GROSS']);

	type Line = PayslipBreakdown['lines'][number];

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
	const earnings = $derived(
		breakdown.lines.filter(
			(line) =>
				line.party === 'EMPLOYEE' &&
				line.period === undefined &&
				line.direction === 'ADD' &&
				line.code !== RECOVERY
		)
	);
	const deductions = $derived(
		breakdown.lines.filter(
			(line) =>
				line.party === 'EMPLOYEE' && line.period === undefined && line.direction === 'DEDUCT'
		)
	);
	const recovery = $derived(
		breakdown.lines.filter(
			(line) => line.party === 'EMPLOYEE' && line.period === undefined && line.code === RECOVERY
		)
	);
	const adjustments = $derived(
		breakdown.lines.filter((line) => line.party === 'EMPLOYEE' && line.period !== undefined)
	);
	const employer = $derived(breakdown.lines.filter((line) => line.party === 'EMPLOYER'));

	const earningsTotal = $derived(earnings.reduce((total, line) => total + line.amount, 0));
	const deductionsTotal = $derived(deductions.reduce((total, line) => total + line.amount, 0));
	const adjustmentsTotal = $derived(
		adjustments.reduce(
			(total, line) => total + (line.direction === 'DEDUCT' ? -line.amount : line.amount),
			0
		)
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

	const money = (value: Parameters<typeof format>[1]) => {
		const numeric =
			typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
		const clean = Number.isFinite(numeric)
			? (Math.abs(numeric) < 1e-12 ? 0 : numeric).toFixed(scale)
			: value;
		return format(
			{ kind: 'money' },
			clean,
			currency === undefined ? { locale: ctx.locale } : { locale: ctx.locale, currency }
		);
	};
	const signedMoney = (value: number) =>
		value < -1e-12 ? `− ${money(Math.abs(value))}` : value > 1e-12 ? `+ ${money(value)}` : money(0);

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

	const leaveContext = (line: Line): string => {
		if (line.source !== 'leave_catalog_entry' || line.period !== undefined) return '';
		const settled = cashOutByCode.get(line.code);
		if (line.direction === 'ADD')
			return settled !== undefined && settled > 0
				? ctx.t('app.payroll.line.exit_encashment')
				: ctx.t('app.payroll.line.leave_encashment');
		if (settled !== undefined && settled < 0) return ctx.t('app.payroll.line.overtaken_leave');
		return '';
	};

	const lineNote = (line: Line) =>
		[measure(line), leaveContext(line), line.period].filter(Boolean).join(' · ');

	const checkpointGuide = (code: string) =>
		ctx.t(`checkpoint.${GUIDED_CHECKPOINTS.find((known) => known === code) ?? 'other'}`);

	const checkpoints = $derived.by(() => {
		const touched = new Set(
			breakdown.lines.filter((line) => line.period === undefined).map((line) => line.subtotal)
		);
		const all = breakdown.checkpoints;
		return all.flatMap((point, index) => {
			const previous = index === 0 ? point.value : (all[index - 1]?.value ?? point.value);
			const delta = point.value - previous;
			const moved = index > 0 && Math.abs(delta) > 1e-9;
			if (
				index === 0 ||
				index === all.length - 1 ||
				moved ||
				touched.has(point.code) ||
				CORE_CHECKPOINTS.has(point.code)
			)
				return [{ point, delta: moved ? delta : 0 }];
			return [];
		});
	});
</script>

{#snippet row(label: string, hint: string | undefined, value: string, note = '', total = false)}
	<Inline
		as="li"
		justify="between"
		align="start"
		gap="md"
		class={total ? 'border-t py-2 text-sm font-medium' : 'py-1.5 text-sm'}
	>
		<Stack gap="none">
			<Inline gap="xs">
				<span class="[overflow-wrap:anywhere]">{label}</span>
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
			{#if note !== ''}<span class="text-xs text-muted-foreground">{note}</span>{/if}
		</Stack>
		<span class="shrink-0 tabular-nums">{value}</span>
	</Inline>
{/snippet}
{#snippet list(
	title: string,
	lines: typeof breakdown.lines,
	total: string,
	sum: Parameters<typeof format>[1]
)}
	<Stack as="section" gap="xs" justify="between">
		<Stack gap="xs">
			<h3 class="border-b pb-2 text-sm font-medium">{title}</h3>
			<Stack as="ul" gap="none">
				{#each lines as line}
					{@render row(
						lineLabel(line),
						lineHint(line),
						`${line.party === 'EMPLOYER' && line.direction === 'DEDUCT' ? '− ' : ''}${money(line.amount)}`,
						lineNote(line)
					)}
				{/each}
			</Stack>
		</Stack>
		<Stack as="ul" gap="none">
			{@render row(total, undefined, money(sum), '', true)}
		</Stack>
	</Stack>
{/snippet}
<RecordShell
	{ctx}
	of="payslip"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record !== null}<Stack gap="md">
			{#if contextLine !== ''}
				<p class="text-xs text-muted-foreground">{contextLine}</p>
			{/if}
			{#if earnings.length > 0 || deductions.length > 0}
				<Grid minimum="compact" gap="lg">
					{@render list(
						ctx.t('app.payroll.earnings'),
						earnings,
						ctx.t('app.payroll.total_earnings'),
						earningsTotal
					)}
					{@render list(
						ctx.t('app.payroll.deductions'),
						deductions,
						ctx.t('app.payroll.total_deductions'),
						deductionsTotal
					)}
				</Grid>
			{/if}
			{#if adjustments.length > 0}
				<Stack as="section" gap="xs">
					<h3 class="border-b pb-2 text-sm font-medium">
						{ctx.t('app.payroll.adjustments_for_earlier_periods')}
					</h3>
					<p class="text-xs text-muted-foreground">{ctx.t('app.payroll.adjustments_help')}</p>
					<Stack as="ul" gap="none">
						{#each adjustments as line}
							{@render row(
								lineLabel(line),
								lineHint(line),
								signedMoney(line.direction === 'DEDUCT' ? -line.amount : line.amount),
								lineNote(line)
							)}
						{/each}
						{@render row(
							ctx.t('app.payroll.adjustments_total'),
							undefined,
							signedMoney(adjustmentsTotal),
							'',
							true
						)}
					</Stack>
				</Stack>
			{/if}
			{#if recovery.length > 0}
				<Stack as="ul" gap="none" class="border-t pt-1">
					{#each recovery as line}
						{@render row(lineLabel(line), lineHint(line), signedMoney(line.amount), lineNote(line))}
					{/each}
				</Stack>
			{/if}
			<Inline justify="between" gap="md" class="border-y-2 py-3 text-base font-medium">
				<span>{ctx.t('app.payroll.net_pay')}</span>
				<span class="shrink-0 tabular-nums">{money(record.net_pay)}</span>
			</Inline>
			{#if employer.length > 0}
				{@render list(
					ctx.t('app.payroll.employer_contributions'),
					employer,
					ctx.t('app.payroll.total_employer_contributions'),
					record.employer_cost
				)}
			{/if}
			{#if checkpoints.length > 0}
				<Section
					name="calculation_details"
					icon="lucide:calculator"
					title={ctx.t('app.payroll.calculation_details')}
					default_open={false}
				>
					<Stack as="ul" gap="none">
						{#each checkpoints as { point, delta } (point.code)}
							{@render row(
								point.name.trim() || point.code,
								checkpointGuide(point.code),
								money(point.value),
								delta === 0 ? '' : signedMoney(delta)
							)}
						{/each}
					</Stack>
				</Section>
			{/if}
		</Stack>
	{/if}
</RecordShell>
