<script lang="ts">
	/**
	 * Creating a payroll run is choosing two facts: which company, and which period.
	 *
	 * Everything else on the record — the attendance window, the pay date, the configuration hash
	 * and the lifecycle — is derived by the create hook, which is the only place that can see the
	 * whole governing configuration. The window shown here comes from the engine's own
	 * `resolveWindow`, so the operator reads the same cutoff rule the run will be built with rather
	 * than a second derivation of it.
	 *
	 * A record opens on the run itself: the window it was built against and the payslips it
	 * produced. The window, the configuration hash and the period are the engine's — they are shown,
	 * never edited, because a run that could be re-pointed after it was calculated would be
	 * untraceable. A refused draft is deleted and created again — CollectionTable deletion and
	 * CollectionForm create already own pending and error.
	 * Permission checks, approval locks, request-change reasons, and audit history belong to the
	 * platform.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Effect, Result } from 'effect';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { MonthPicker } from '@norbital-ai/ui/month-picker';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { resolveWindow } from './lib/period.js';
	import { formatCalendarDate } from '../../lib/ui/display-formatters.js';
	import { periodWindow } from '../../lib/ui/calendar.js';
	import {
		payrollRunPayslipsQuery,
		payslipAmount,
		payslipEmployeeCode,
		type PayrollRunPayslipRow
	} from './payslip-table.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	// Company calendar data can fail `resolveWindow` (a cutoff out of range, a calendar with no
	// instalments). The failure is a condition of membership, not an error to show — an unusable
	// company simply offers no period — so it is carried on the Effect channel and read as `null`.
	const windowFor = (
		period: string,
		company: Parameters<typeof resolveWindow>[1]
	): ReturnType<typeof resolveWindow> | null =>
		Result.getOrNull(
			Effect.runSync(Effect.result(Effect.sync(() => resolveWindow(period, company))))
		);

	// Companies must be live. Runs are intentionally not filtered by approval state: a provisional
	// row still occupies the physical company/period key and must not be offered a second time.
	const companiesQuery = $derived(
		client.db.companies.findMany({
			where: { approval_id: { isNull: true } },
			orderBy: { name: 'asc' },
			limit: 500
		})
	);
	const jurisdictionsQuery = $derived(
		client.db.jurisdictions.findMany({
			where: { approval_id: { isNull: true } },
			limit: 500
		})
	);
	const runsQuery = $derived(
		client.db.payroll_runs.findMany({
			orderBy: { period: 'desc' },
			limit: 10_000
		})
	);

	let companyId = $state<string | null>(null);
	let period = $state<string | null>(null);

	const companies = $derived(companiesQuery.current ?? []);
	const currencyByJurisdiction = $derived(
		new Map(
			(jurisdictionsQuery.current ?? []).map((jurisdiction) => [
				jurisdiction.id,
				jurisdiction.currency
			])
		)
	);
	const companyOptions = $derived(
		companies.flatMap((company) => {
			const currency = currencyByJurisdiction.get(company.jurisdiction_id);
			// Without its jurisdiction a company has no currency, and payroll has nothing to pay in.
			if (!currency) return [];
			return [
				{
					value: company.id,
					label: `${company.name} · ${currency}`,
					search_term: `${company.name} ${company.registration_number} ${currency}`
				}
			];
		})
	);
	const selectedCompany = $derived(companies.find((company) => company.id === companyId) ?? null);

	const periodCandidates = $derived(periodWindow(37, 12));
	const settledPeriods = $derived(
		new Set(
			(runsQuery.current ?? [])
				.filter((run) => selectedCompany != null && run.company_id === selectedCompany.id)
				.map((run) => run.period)
		)
	);

	/**
	 * The months the grid picker leaves enabled: inside the 37+12 offer window, not already
	 * settled, and on a pay calendar the engine can actually build. The pay-date detail the old
	 * option label carried now reads off `selectedWindow` below instead.
	 */
	function isPeriodDisabled(candidate: string): boolean {
		const company = selectedCompany;
		if (company == null || settledPeriods.has(candidate)) return true;
		return windowFor(candidate, company) == null;
	}

	const selectedWindow = $derived.by(() => {
		const company = selectedCompany;
		if (!company || !period) return null;
		return windowFor(period, company);
	});

	// Record display: one run, its window and its payslips.
	const recordCompanyQuery = $derived(
		record == null
			? null
			: client.db.companies.findFirst({ where: { id: { eq: record.company_id } } })
	);
	const recordCompany = $derived(recordCompanyQuery?.current ?? null);
	const payslipCountQuery = $derived(
		record == null
			? null
			: client.db.payslips.count({ where: { payroll_run_id: { eq: record.id } } })
	);
	const payslipsTableQuery = $derived(
		record == null ? undefined : payrollRunPayslipsQuery(record.id)
	);
	// Only while a count has actually come back. `?? 0` on a query still in flight would flash the
	// refusal notice on every run, including the ones that built perfectly.
	const payslipCount = $derived(payslipCountQuery?.current ?? null);
	const emptyDraft = $derived(record != null && record.lifecycle === 'DRAFT' && payslipCount === 0);
</script>

{#if record}
	<Stack gap="lg">
		<Stack as="section" gap="sm" aria-label={t('component.payroll_run_summary')}>
			<Cluster align="start" justify="between" gap="sm">
				<Stack gap="none" class="min-w-0">
					<h2 class="truncate text-heading">
						{recordCompany?.name ?? t('component.company')}
					</h2>
					<p class="text-sm text-muted-foreground">
						{t('component.period_line', {
							period: record.period,
							count: payslipCount ?? 0
						})}
					</p>
				</Stack>
				<span class="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
					{record.lifecycle}
				</span>
			</Cluster>
			<Grid as="dl" gap="sm" minimum="compact">
				<Stack gap="xs">
					<dt class="text-meta">{t('component.attendance_window')}</dt>
					<dd class="font-medium tabular-nums">
						{formatCalendarDate(record.attendance_from)} → {formatCalendarDate(
							record.attendance_to
						)}
					</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{t('app.payroll.pay_date')}</dt>
					<dd class="font-medium tabular-nums">{formatCalendarDate(record.pay_date)}</dd>
				</Stack>
			</Grid>
		</Stack>

		{#if emptyDraft}
			<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{t('component.draft_built_nothing')}
			</p>
		{/if}

		<Stack as="section" gap="sm" aria-label={t('component.payslips')}>
			<CollectionTable
				{client}
				collection="payslips"
				title={t('component.payslips')}
				description={t('component.payslips_description')}
				features={{ create: false }}
				query={payslipsTableQuery}
				bounded={false}
			>
				{#snippet columns({ Column })}
					<Column
						name="employment_id"
						label={t('component.employee')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PayrollRunPayslipRow }) => payslipEmployeeCode(row)
						}}
					/>
					<Column name="currency" card="badge" />
					<Column
						name="gross"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PayrollRunPayslipRow }) => payslipAmount(row, 'gross')
						}}
					/>
					<Column
						name="total_deductions"
						label={t('component.deductions')}
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PayrollRunPayslipRow }) =>
								payslipAmount(row, 'total_deductions')
						}}
					/>
					<Column
						name="net"
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PayrollRunPayslipRow }) => payslipAmount(row, 'net')
						}}
					/>
					<Column
						name="employer_cost"
						label={t('component.employer_cost')}
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: PayrollRunPayslipRow }) =>
								payslipAmount(row, 'employer_cost')
						}}
					/>
				{/snippet}
			</CollectionTable>
		</Stack>
	</Stack>
{:else}
	<CollectionForm
		{client}
		collection="payroll_runs"
		submitLabel={t('component.create_payroll_run')}
		onAfterSubmit={close}
	>
		{#snippet children({ form, Field })}
			<Field name="company_id" hidden />
			<Field name="period" hidden />
			<Field name="lifecycle" hidden />
			<Field name="configuration_hash" hidden />
			<Field name="configuration_snapshot" hidden />
			<Field name="statutory_snapshot_id" hidden />
			<Field name="calculation_version" hidden />
			<Field name="pay_date" hidden />
			<Field name="attendance_from" hidden />
			<Field name="attendance_to" hidden />
			<Stack gap="lg">
				<Grid gap="md" minimum="compact">
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{t('component.legal_entity')}
							<Combobox
								ariaLabel={t('component.legal_entity')}
								options={companyOptions}
								value={companyId}
								onValueChange={(value) => {
									companyId = value;
									period = null;
									form.setValues({ company_id: value });
								}}
								searchPlaceholder={t('component.search_companies')}
								emptyPlaceholder={t('component.choose_legal_entity')}
								disabled={companiesQuery.loading || jurisdictionsQuery.loading}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{t('component.pay_period')}
							<MonthPicker
								value={period}
								onValueChange={(next) => {
									period = next;
									form.setValues({ company_id: companyId, period: next });
								}}
								min={periodCandidates[0]}
								max={periodCandidates[periodCandidates.length - 1]}
								isMonthDisabled={isPeriodDisabled}
								placeholder={companyId
									? t('component.choose_payroll_period')
									: t('component.choose_entity_first')}
								ariaLabel={t('component.pay_period')}
								disabled={!companyId || runsQuery.loading}
							/>
						</Stack>
					</label>
				</Grid>
				{#if selectedWindow}
					<Grid as="dl" gap="sm" minimum="compact">
						<Stack gap="xs">
							<dt class="text-meta">{t('component.salary_month')}</dt>
							<dd class="font-medium tabular-nums">
								{formatCalendarDate(selectedWindow.salary.start)} → {formatCalendarDate(
									selectedWindow.salary.end
								)}
							</dd>
						</Stack>
						<Stack gap="xs">
							<dt class="text-meta">{t('component.attendance_window')}</dt>
							<dd class="font-medium tabular-nums">
								{formatCalendarDate(selectedWindow.attendance.start)} → {formatCalendarDate(
									selectedWindow.attendance.end
								)}
							</dd>
						</Stack>
						<Stack gap="xs">
							<dt class="text-meta">{t('component.pay_date')}</dt>
							<dd class="font-medium tabular-nums">
								{formatCalendarDate(selectedWindow.payDate)}
							</dd>
						</Stack>
					</Grid>
				{/if}
				<p class="text-sm text-muted-foreground">
					{t('component.create_run_hint')}
				</p>
			</Stack>
		{/snippet}
	</CollectionForm>
{/if}
