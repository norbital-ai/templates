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
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { Button } from '@norbital-ai/ui/button';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Bound, Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { resolveWindow } from './lib/period.js';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import { saveCollectionExport } from '../../lib/ui/export-download.js';

	let { record, refresh, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const OFFERED_PERIODS = Array.from(
		{ length: 12 },
		(_value, index) => `2026-${String(index + 1).padStart(2, '0')}`
	);

	// Companies must be live. Runs are intentionally not filtered by approval state: a provisional
	// row still occupies the physical company/period key and must not be offered a second time.
	const companiesQuery = client.db.companies.findMany({
		where: { norbital_approval_id: { isNull: true } },
		orderBy: { name: 'asc' },
		limit: 500
	});
	const jurisdictionsQuery = client.db.jurisdictions.findMany({
		where: { norbital_approval_id: { isNull: true } },
		limit: 500
	});
	const runsQuery = client.db.payroll_runs.findMany({
		orderBy: { period: 'desc' },
		limit: 1000
	});

	let companyId = $state<string | null>(null);
	let period = $state<string | null>(null);

	const companies = $derived(companiesQuery.current ?? []);
	const currencyByJurisdiction = $derived(
		new Map(
			(jurisdictionsQuery.current ?? []).map((jurisdiction) => [
				jurisdiction.norbital_id,
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
					value: company.norbital_id,
					label: `${company.name} · ${currency}`,
					search_term: `${company.name} ${company.registration_number} ${currency}`
				}
			];
		})
	);
	const selectedCompany = $derived(
		companies.find((company) => company.norbital_id === companyId) ?? null
	);

	const periodOptions = $derived.by(() => {
		const company = selectedCompany;
		if (!company) return [];
		const settled = new Set(
			(runsQuery.current ?? [])
				.filter((run) => run.company_id === company.norbital_id)
				.map((run) => run.period)
		);
		return OFFERED_PERIODS.filter((candidate) => !settled.has(candidate)).flatMap((candidate) => {
			// A company whose pay calendar is unusable has no offerable period; it must be fixed
			// on the company, not guessed at here.
			try {
				const window = resolveWindow(candidate, company);
				return [
					{
						value: candidate,
						label: `${candidate} · Pay ${formatCalendarDate(window.payDate)}`,
						search_term: `${candidate} ${window.attendance.start} ${window.attendance.end}`
					}
				];
			} catch {
				return [];
			}
		});
	});

	const selectedWindow = $derived.by(() => {
		const company = selectedCompany;
		if (!company || !period) return null;
		try {
			return resolveWindow(period, company);
		} catch {
			return null;
		}
	});

	// Record display: one run, its window and its payslips.
	const recordCompanyQuery = $derived(
		record == null
			? null
			: client.db.companies.findFirst({ where: { norbital_id: { eq: record.company_id } } })
	);
	const recordCompany = $derived(recordCompanyQuery?.current ?? null);
	const payslipCountQuery = $derived(
		record == null
			? null
			: client.db.payslips.count({ where: { payroll_run_id: { eq: record.norbital_id } } })
	);
	// A payslip's employment column holds a uuid. The run belongs to one company, so that company's
	// employments are the only ones the table below can show; the employee number is resolved from
	// that one set rather than by mounting a lookup per row, and a miss renders as an em dash.
	const recordEmploymentsQuery = $derived(
		record == null
			? null
			: client.db.employments.findMany({
					where: { company_id: { eq: record.company_id }, norbital_approval_id: { isNull: true } },
					limit: 1000
				})
	);
	const recordEmploymentLabelsById = $derived(
		new Map(
			(recordEmploymentsQuery?.current ?? []).map((employment) => [
				employment.norbital_id,
				employment.employee_number
			])
		)
	);

	let pendingAction = $state<'recalculate' | 'pay' | 'delete' | 'export' | null>(null);
	let lockArmed = $state(false);
	/**
	 * The engine's refusal, kept on screen rather than in a toast.
	 *
	 * A refused build is not a failed request: the run record is written before the engine starts —
	 * it has to be, the engine needs a run id to hang payslips on — and the platform commits each
	 * statement on its own, so a build that refuses leaves the record standing with nothing under it.
	 * The refusal is therefore the only account of what happened, and it names up to twenty-five
	 * records to fix. A toast that clears itself in a few seconds is the wrong shape for that.
	 */
	let refusal = $state<string | null>(null);
	// Only while a count has actually come back. `?? 0` on a query still in flight would flash the
	// refusal notice on every run, including the ones that built perfectly.
	const payslipCount = $derived(payslipCountQuery?.current ?? null);
	const emptyDraft = $derived(
		record != null && record.lifecycle === 'DRAFT' && payslipCount === 0 && refusal == null
	);

	async function updateDraft(action: 'recalculate' | 'pay'): Promise<void> {
		if (record == null) return;
		const update = client.db.payroll_runs.update;
		if (!update) {
			toast.error(t('component.cannot_update'));
			return;
		}
		pendingAction = action;
		try {
			await update(record.norbital_id, {
				lifecycle: action === 'pay' ? 'PAID' : 'DRAFT'
			});
			refusal = null;
			toast.success(action === 'pay' ? t('component.marked_paid') : t('component.recalculated'));
			void refresh().catch(() => {
				toast.error(t('component.no_refresh'));
			});
		} catch (error) {
			// The engine's own message, verbatim and in full. It is a list of the records that must be
			// fixed, so truncating it or replacing it with a generic failure would throw away the only
			// part an operator can act on.
			const message = error instanceof Error ? error.message : t('component.update_failed');
			refusal = message;
			toast.error(message.split('\n')[0] ?? message);
		} finally {
			pendingAction = null;
		}
	}

	async function downloadReport(): Promise<void> {
		if (record == null) return;
		pendingAction = 'export';
		try {
			const manifest = await downloadCollectionExport(
				{ collection_name: 'payroll_runs', record_ids: [record.norbital_id] },
				{ includeAction: (action) => action.metadata?.kind === 'payroll-report-xlsx' }
			);
			if (manifest.length === 0) throw new Error(t('component.build_before_export'));
			saveCollectionExport(manifest);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('component.export_failed'));
		} finally {
			pendingAction = null;
		}
	}

	async function deleteDraft(): Promise<void> {
		if (record == null) return;
		const remove = client.db.payroll_runs.delete;
		if (!remove) {
			toast.error(t('component.cannot_delete'));
			return;
		}
		pendingAction = 'delete';
		try {
			await remove(record.norbital_id);
			toast.success(t('component.draft_deleted', { period: record.period }));
			close();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('component.delete_failed'));
		} finally {
			pendingAction = null;
		}
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
						{record.lifecycle}
					</span>
					{#if record.lifecycle === 'DRAFT' && client.db.payroll_runs.update}
						<Button
							variant="outline"
							size="sm"
							disabled={pendingAction !== null}
							onclick={downloadReport}
						>
							{pendingAction === 'export'
								? t('component.exporting')
								: t('component.export_salary_listing')}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={pendingAction !== null}
							onclick={() => updateDraft('recalculate')}
						>
							{pendingAction === 'recalculate'
								? t('component.recalculating')
								: t('component.recalculate_draft')}
						</Button>
						<Button
							size="sm"
							disabled={pendingAction !== null}
							onclick={() => {
								if (!lockArmed) {
									lockArmed = true;
									return;
								}
								void updateDraft('pay');
							}}
						>
							{pendingAction === 'pay'
								? t('component.locking')
								: lockArmed
									? t('component.confirm_lock_pay')
									: t('component.lock_payroll')}
						</Button>
						{#if client.db.payroll_runs.delete}
							<Button
								variant="outline"
								size="sm"
								disabled={pendingAction !== null}
								onclick={deleteDraft}
							>
								{pendingAction === 'delete' ? t('component.deleting') : t('component.delete_draft')}
							</Button>
						{/if}
					{/if}
				</Inline>
			</Cluster>
			<Grid as="dl" gap="sm" minimum="compact">
				<div>
					<dt class="text-meta">{t('component.attendance_window')}</dt>
					<dd class="mt-1 font-medium tabular-nums">
						{formatCalendarDate(record.attendance_from)} → {formatCalendarDate(
							record.attendance_to
						)}
					</dd>
				</div>
				<div>
					<dt class="text-meta">{t('app.payroll.pay_date')}</dt>
					<dd class="mt-1 font-medium tabular-nums">{formatCalendarDate(record.pay_date)}</dd>
				</div>
				<div>
					<dt class="text-meta">{t('component.run_snapshot')}</dt>
					<dd class="mt-1 text-sm font-medium">
						{t('component.captured_at_run_time')}
					</dd>
				</div>
			</Grid>
		</Stack>

		{#if lockArmed && record.lifecycle === 'DRAFT'}
			<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{t('component.lock_warning')}
			</p>
		{/if}

		{#if refusal}
			<Stack
				as="section"
				gap="xs"
				aria-label={t('component.run_refused')}
				class="rounded-md border border-destructive/40 bg-destructive/10 p-3"
			>
				<h3 class="text-sm font-semibold">{t('component.run_refused')}</h3>
				<p class="text-sm whitespace-pre-line">{refusal}</p>
			</Stack>
		{:else if emptyDraft}
			<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{t('component.draft_built_nothing')}
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
						where: { payroll_run_id: { eq: record.norbital_id } },
						orderBy: { norbital_created_at: 'asc' },
						limit: 100
					}}
				>
					{#snippet columns({ Column })}
						<Column
							name="employment_id"
							label={t('component.employee')}
							card="title"
							render={({ value }) =>
								value == null || value === ''
									? '—'
									: (recordEmploymentLabelsById.get(String(value)) ?? '—')}
						/>
						<Column name="currency" card="badge" />
						<Column name="gross" render={({ value }) => formatNumeric(value)} />
						<Column
							name="total_deductions"
							label={t('component.deductions')}
							render={({ value }) => formatNumeric(value)}
						/>
						<Column name="net" card="subtitle" render={({ value }) => formatNumeric(value)} />
						<Column
							name="employer_cost"
							label={t('component.employer_cost')}
							render={({ value }) => formatNumeric(value)}
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
		onSubmit={async () => {
			const company = selectedCompany;
			if (!company) throw new Error('Choose a legal entity.');
			if (!period) throw new Error('Choose a payroll period.');
			const create = client.db.payroll_runs.create;
			if (!create) throw new Error('Payroll runs cannot be created in this workspace.');
			// Only the two chosen facts are sent. The window, the pay date and the configuration hash
			// are resolved by the create hook against the configuration effective at period end —
			// the client cannot see that configuration, so it has no business asserting them. The
			// window shown above is the same derivation, for the operator to read before committing.
			return create({ company_id: company.norbital_id, period });
		}}
		onAfterSubmit={close}
	>
		{#snippet children({ form })}
			<Stack gap="lg">
				<Grid gap="md" minimum="compact">
					<label class="grid gap-1.5 text-sm font-medium">
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
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
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
					</label>
				</Grid>
				{#if selectedWindow}
					<Grid as="dl" gap="sm" minimum="compact">
						<div>
							<dt class="text-meta">{t('component.salary_month')}</dt>
							<dd class="mt-1 font-medium tabular-nums">
								{formatCalendarDate(selectedWindow.salary.start)} → {formatCalendarDate(
									selectedWindow.salary.end
								)}
							</dd>
						</div>
						<div>
							<dt class="text-meta">{t('component.attendance_window')}</dt>
							<dd class="mt-1 font-medium tabular-nums">
								{formatCalendarDate(selectedWindow.attendance.start)} → {formatCalendarDate(
									selectedWindow.attendance.end
								)}
							</dd>
						</div>
						<div>
							<dt class="text-meta">{t('component.pay_date')}</dt>
							<dd class="mt-1 font-medium tabular-nums">
								{formatCalendarDate(selectedWindow.payDate)}
							</dd>
						</div>
					</Grid>
				{/if}
				<p class="text-sm text-muted-foreground">
					{t('component.create_run_hint')}
				</p>
			</Stack>
		{/snippet}
	</CollectionForm>
{/if}
