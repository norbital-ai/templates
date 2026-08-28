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
	 * untraceable. Draft recalculation and the final paid transition are explicit actions.
	 * Permission checks, approval locks, request-change reasons, and audit history belong to the
	 * platform.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { downloadCollectionExport } from '@norbital-ai/bolt/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Effect, Result } from 'effect';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { Button } from '@norbital-ai/ui/button';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { Bound, Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { resolveWindow } from './lib/period.js';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import { saveCollectionExport } from '../../lib/ui/export-download.js';
	import type { WorkspaceRow } from '$bolt/types.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	type PayslipWithEmployment = WorkspaceRow<'payslips'> & {
		readonly payslip_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
	};
	const updateAccessQuery = client.system.access.explain({
		action: 'update',
		resource: 'payroll_runs'
	});
	const mayUpdatePayroll = $derived(updateAccessQuery.current?.allowed === true);

	const OFFERED_PERIODS = Array.from(
		{ length: 12 },
		(_value, index) => `2026-${String(index + 1).padStart(2, '0')}`
	);

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
			limit: 1000
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

	const periodOptions = $derived.by(() => {
		const company = selectedCompany;
		if (!company) return [];
		const settled = new Set(
			(runsQuery.current ?? [])
				.filter((run) => run.company_id === company.id)
				.map((run) => run.period)
		);
		return OFFERED_PERIODS.filter((candidate) => !settled.has(candidate)).flatMap((candidate) => {
			// A company whose pay calendar is unusable has no offerable period; it must be fixed
			// on the company, not guessed at here.
			const window = windowFor(candidate, company);
			if (window == null) return [];
			return [
				{
					value: candidate,
					label: `${candidate} · Pay ${formatCalendarDate(window.payDate)}`,
					search_term: `${candidate} ${window.attendance.start} ${window.attendance.end}`
				}
			];
		});
	});

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
	let lockArmed = $state(false);
	let payrollRecalculationPending = $state(false);
	let payrollFinalizationPending = $state(false);
	// Only while a count has actually come back. `?? 0` on a query still in flight would flash the
	// refusal notice on every run, including the ones that built perfectly.
	const payslipCount = $derived(payslipCountQuery?.current ?? null);
	const emptyDraft = $derived(record != null && record.lifecycle === 'DRAFT' && payslipCount === 0);

	function updateDraft(action: 'recalculate' | 'pay'): void {
		if (record == null) return;
		const payrollRunId = record.id;
		if (action === 'recalculate') {
			payrollRecalculationPending = true;
			Effect.runFork(
				Effect.gen(function* () {
					const local = yield* Effect.tryPromise({
						try: () => client.db.payroll_runs.mutate({ id: payrollRunId, lifecycle: 'DRAFT' }),
						catch: (cause) => cause
					});
					// Recalculation's useful values are produced by server hooks, not by the local row.
					// Keep progress visible until settlement; the payslip queries read the result reactively.
					const settlement = yield* Effect.tryPromise({
						try: () => local.settlement.wait(),
						catch: (cause) => cause
					});
					if (settlement.kind !== 'accepted' && settlement.kind !== 'rebased') {
						return yield* Effect.fail(
							new Error(
								settlement.kind === 'rejected' ? settlement.message : settlement.quarantine.message
							)
						);
					}
				}).pipe(
					Effect.catch((cause) =>
						Effect.sync(() =>
							toast.error(cause instanceof Error ? cause.message : t('component.update_failed'))
						)
					),
					Effect.ensuring(Effect.sync(() => (payrollRecalculationPending = false)))
				)
			);
			return;
		}

		payrollFinalizationPending = true;
		Effect.runFork(
			Effect.gen(function* () {
				const local = yield* Effect.tryPromise({
					try: () => client.db.payroll_runs.mutate({ id: payrollRunId, lifecycle: 'PAID' }),
					catch: (cause) => cause
				});
				// Paying is irreversible and globally constrained. The overlay may show PAID immediately,
				// but the operator-facing action remains pending until authoritative settlement is known.
				const settlement = yield* Effect.tryPromise({
					try: () => local.settlement.wait(),
					catch: (cause) => cause
				});
				if (settlement.kind !== 'accepted' && settlement.kind !== 'rebased') {
					return yield* Effect.fail(
						new Error(
							settlement.kind === 'rejected' ? settlement.message : settlement.quarantine.message
						)
					);
				}
				lockArmed = false;
			}).pipe(
				Effect.catch((cause) =>
					Effect.sync(() =>
						toast.error(cause instanceof Error ? cause.message : t('component.update_failed'))
					)
				),
				Effect.ensuring(Effect.sync(() => (payrollFinalizationPending = false)))
			)
		);
	}

	function downloadReport(): void {
		if (record == null) return;
		Effect.runPromise(
			Effect.map(
				Effect.result(
					Effect.tryPromise(() =>
						downloadCollectionExport(
							{ collection_name: 'payroll_runs', record_ids: [record.id] },
							{ includeAction: (action) => action.metadata?.kind === 'payroll-report-xlsx' }
						)
					)
				),
				(attempt) => {
					if (Result.isFailure(attempt)) {
						toast.error(
							attempt.failure instanceof Error
								? attempt.failure.message
								: t('component.export_failed')
						);
						return;
					}
					const manifest = attempt.success;
					if (manifest.length === 0) {
						toast.error(t('component.build_before_export'));
						return;
					}
					saveCollectionExport(manifest);
				}
			)
		);
	}
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
				<Inline gap="xs" justify="end" shrink={false}>
					<span class="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
						{payrollFinalizationPending ? t('component.locking') : record.lifecycle}
					</span>
					{#if record.lifecycle === 'DRAFT'}
						<Button variant="outline" size="sm" onclick={downloadReport}>
							{t('component.export_salary_listing')}
						</Button>
						{#if mayUpdatePayroll}
							<Button
								variant="outline"
								size="sm"
								disabled={client.db.payroll_runs.pending > 0 ||
									payrollRecalculationPending ||
									payrollFinalizationPending}
								onclick={() => updateDraft('recalculate')}
							>
								{payrollRecalculationPending
									? t('component.recalculating')
									: t('component.recalculate_draft')}
							</Button>
							<Button
								size="sm"
								disabled={client.db.payroll_runs.pending > 0 ||
									payrollRecalculationPending ||
									payrollFinalizationPending}
								onclick={() => {
									if (!lockArmed) {
										lockArmed = true;
										return;
									}
									updateDraft('pay');
								}}
							>
								{payrollFinalizationPending
									? t('component.locking')
									: lockArmed
										? t('component.confirm_lock_pay')
										: t('component.lock_payroll')}
							</Button>
						{/if}
					{/if}
				</Inline>
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
				<Stack gap="xs">
					<dt class="text-meta">{t('component.run_snapshot')}</dt>
					<dd class="text-sm font-medium">
						{t('component.captured_at_run_time')}
					</dd>
				</Stack>
			</Grid>
		</Stack>

		{#if lockArmed && record.lifecycle === 'DRAFT'}
			<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{t('component.lock_warning')}
			</p>
		{/if}
		{#if payrollFinalizationPending}
			<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
				{t('component.locking')}
			</p>
		{/if}

		{#if emptyDraft}
			<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{mayUpdatePayroll
					? t('component.draft_built_nothing')
					: t('component.draft_built_nothing_view_only')}
			</p>
		{/if}

		<Stack as="section" gap="sm" aria-labelledby="run-payslips-heading">
			<h3 id="run-payslips-heading" class="text-sm font-semibold">{t('component.payslips')}</h3>
			<Bound size="tall">
				<CollectionTable
					{client}
					collection="payslips"
					title={t('component.payslips')}
					description={t('component.payslips_description')}
					features={{ create: false }}
					query={{
						where: { payroll_run_id: { eq: record.id } },
						orderBy: { created_at: 'asc' },
						with: {
							payslip_employment: { columns: { employee_number: true } }
						},
						limit: 100
					}}
				>
					{#snippet columns({ Column })}
						<Column
							name="employment_id"
							label={t('component.employee')}
							card="title"
							renderer={FormattedValueRenderer}
							rendererProps={{
								format: ({ row }: { row: PayslipWithEmployment }) =>
									row.payslip_employment?.employee_number ?? '—'
							}}
						/>
						<Column name="currency" card="badge" />
						<Column
							name="gross"
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ value }) => formatNumeric(value) }}
						/>
						<Column
							name="total_deductions"
							label={t('component.deductions')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ value }) => formatNumeric(value) }}
						/>
						<Column
							name="net"
							card="subtitle"
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ value }) => formatNumeric(value) }}
						/>
						<Column
							name="employer_cost"
							label={t('component.employer_cost')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ value }) => formatNumeric(value) }}
						/>
					{/snippet}
				</CollectionTable>
			</Bound>
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
							<Combobox
								ariaLabel={t('component.pay_period')}
								options={periodOptions}
								value={period}
								onValueChange={(value) => {
									period = value;
									form.setValues({ company_id: companyId, period: value });
								}}
								searchPlaceholder={t('component.search_payroll_periods')}
								emptyPlaceholder={companyId
									? t('component.choose_payroll_period')
									: t('component.choose_entity_first')}
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
