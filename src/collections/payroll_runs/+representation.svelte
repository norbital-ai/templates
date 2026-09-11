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
	 * The period is offered in the company's grammar. A monthly company picks a month from the
	 * grid; a semi-monthly company picks a half ("Feb 2026 · 1–15" or "Feb 2026 · 16–28") from a
	 * list, because a month grid has no cell for half of one. `resolveWindow` refuses the other
	 * grammar, so the candidates it leaves are exactly the ones the hook would accept.
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
	import { PAYROLL_RUN_LIST_COLUMNS } from './list-columns.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Effect, Result } from 'effect';
	import type { CollectionFilter } from '@norbital-ai/std/collection';
	import { collectionCatalog } from '$bolt/collections.js';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import {
		CollectionTable,
		collectionTableRowMatchesFilters,
		collectionTableRowMatchesSearch
	} from '@norbital-ai/ui/collection-table';
	import { CollectionToolbarQueryControls } from '@norbital-ai/ui/collection-toolbar';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { MonthPicker, monthLabel } from '@norbital-ai/ui/month-picker';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { resolveWindow } from './lib/period.js';
	import { formatCalendarDate, formatCalendarInstant } from '../../lib/ui/display-formatters.js';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import {
		companyPeriods,
		periodDayRange,
		periodMonthOf,
		periodWindow
	} from '../../lib/ui/calendar.js';
	import {
		payrollRunPayslipsQuery,
		payslipAmount,
		payslipEmployeeCode,
		type PayrollRunPayslipRow
	} from './payslip-table.js';

	let { record, close }: RepresentationProps = $props();
	const { t, intlLocale } = useI18n<TenantI18nKeys>();

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
	const settingsQuery = $derived(
		client.db.jurisdiction_settings.findMany({
			where: { approval_id: { isNull: true } },
			columns: { code: true, currency: true },
			limit: 500
		})
	);
	const runsQuery = $derived(
		client.db.payroll_runs.findMany({
			orderBy: { period: 'desc' },
			columns: PAYROLL_RUN_LIST_COLUMNS,
			limit: 10_000
		})
	);
	/**
	 * The entity the page is already scoped to. Every operator page here is scoped by the combobox
	 * in its header, and this form asked for the same thing a second time — an operator who picked
	 * a different one built a run for an entity the table in front of them does not show.
	 */
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	let companyId = $state<string | null>(null);
	$effect(() => {
		if (scopedCompanyId != null && companyId !== scopedCompanyId) companyId = scopedCompanyId;
	});
	let period = $state<string | null>(null);

	/**
	 * The people this run would pay, so the operator can name the exceptions.
	 *
	 * The run's population is not assembled here — it is everyone eligible in the period, decided by
	 * the engine — and this list exists only so a person can be *taken out* of it with a reason.
	 * Offering it as a picker to build a run from would put back exactly the failure the withhold
	 * exists to remove: somebody left off a list is indistinguishable from somebody forgotten.
	 */
	const employmentsQuery = $derived(
		companyId == null
			? null
			: client.db.employments.findMany({
					where: { company_id: { eq: companyId }, approval_id: { isNull: true } },
					columns: {
						id: true,
						employee_id: true,
						employee_number: true,
						hire_date: true,
						bank: true,
						effective_range: true,
						exit_date: true,
						exit_reason: true,
						exit_note: true,
						children: true
					},
					orderBy: { employee_number: 'asc' },
					limit: 10_000
				})
	);
	/** The person behind each employment number, so the matrix reads as a name, not a code. */
	const employeeIds = $derived([
		...new Set((employmentsQuery?.current ?? []).map((employment) => employment.employee_id))
	]);
	const employeesQuery = $derived(
		employeeIds.length === 0
			? null
			: client.db.employees.findMany({
					where: { id: { in: employeeIds } },
					columns: { id: true, name: true },
					limit: 10_000
				})
	);
	const employeeNameById = $derived(
		new Map((employeesQuery?.current ?? []).map((row) => [row.id, row.name]))
	);
	type PayrollPerson = {
		readonly id: string;
		readonly employee_id: string;
		readonly employee_number: string;
		readonly employee_name: string;
		readonly exit_date: string | null;
		readonly employment_employee: { readonly name: string };
	};
	const people = $derived<readonly PayrollPerson[]>(
		(employmentsQuery?.current ?? []).map((employment) => {
			const employeeName = employeeNameById.get(employment.employee_id) ?? '';
			return {
				...employment,
				employee_name: employeeName,
				employment_employee: { name: employeeName }
			};
		})
	);
	/** The toolbar's search and filters, evaluated against the in-memory list. */
	let personSearch = $state('');
	let personFilters = $state<readonly CollectionFilter[]>([]);
	const visiblePeople = $derived(
		people.filter(
			(person) =>
				collectionTableRowMatchesSearch(person, personSearch) &&
				collectionTableRowMatchesFilters(person, personFilters)
		)
	);
	/**
	 * Who the selected period has already paid.
	 *
	 * A period is one run per entity, so the people on that run's payslips are already settled and
	 * cannot be withheld into another run of the same period. They are shown rather than hidden:
	 * "Aisyah is not in this list" and "Aisyah has already been run for January" are different
	 * facts, and only one of them is worth investigating.
	 */
	const periodRunQuery = $derived(
		companyId == null || period == null
			? null
			: client.db.payroll_runs.findMany({
					where: { company_id: { eq: companyId }, period: { eq: period } },
					columns: { id: true },
					limit: 2
				})
	);
	const periodRun = $derived(periodRunQuery?.current?.[0] ?? null);
	const alreadyRunQuery = $derived(
		periodRun == null
			? null
			: client.db.payslips.findMany({
					where: { payroll_run_id: { eq: periodRun.id } },
					columns: { employment_id: true },
					limit: 10_000
				})
	);
	const alreadyRun = $derived(
		new Set((alreadyRunQuery?.current ?? []).map((row) => row.employment_id))
	);
	const eligibleEmployments = $derived(
		visiblePeople.filter((person) => !alreadyRun.has(person.id))
	);
	/** `employment_id -> reason`; an entry exists only while the person is withheld. */
	let withheld = $state<Record<string, string>>({});
	const withholdings = $derived(
		Object.entries(withheld).map(([employment_id, reason]) => ({ employment_id, reason }))
	);
	const allHeld = $derived(
		eligibleEmployments.length > 0 &&
			eligibleEmployments.every((employment) => employment.id in withheld)
	);
	const someHeld = $derived(eligibleEmployments.some((employment) => employment.id in withheld));
	// A person can only be withheld from the entity the form is on, and who has already run depends
	// on the period, so changing either clears the exception list.
	$effect(() => {
		void companyId;
		void period;
		withheld = {};
	});

	const companies = $derived(companiesQuery.current ?? []);
	// Every version of a lineage states the same currency; the first one read names it.
	const currencyByLineage = $derived(
		new Map((settingsQuery.current ?? []).map((version) => [version.code, version.currency]))
	);
	const companyOptions = $derived(
		companies.flatMap((company) => {
			const currency = currencyByLineage.get(company.settings_code);
			// Without a settings lineage a company has no currency, and payroll has nothing to pay in.
			if (!currency) return [];
			return [
				{
					value: company.id,
					label: `${company.name} · ${currency}`,
					search_term: `${company.name} ${company.registration_number ?? ''} ${currency}`
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
	 * The periods a company can still run: inside the 37+12 offer window, not already settled, and
	 * on a pay calendar the engine can actually build, which is where the grammar is enforced, since
	 * `resolveWindow` refuses a half at a monthly company and a month at a semi-monthly one. The
	 * month grid asks this per cell; the half list is filtered by it. The pay-date detail the old
	 * option label carried now reads off `selectedWindow` below instead.
	 */
	function isPeriodDisabled(candidate: string): boolean {
		const company = selectedCompany;
		if (company == null) return true;
		if (settledPeriods.has(candidate)) return true;
		return windowFor(candidate, company) == null;
	}

	const semiMonthly = $derived(selectedCompany?.pay_frequency === 'SEMI_MONTHLY');

	/** "Feb 2026 · 1–15": the month in the viewer's locale, then the days the half pays for. */
	function halfLabel(candidate: string): string {
		const range = periodDayRange(candidate);
		return t('component.period_half', {
			month: monthLabel(intlLocale, periodMonthOf(candidate), 'short'),
			from: range.from,
			to: range.to
		});
	}
	/** The halves a semi-monthly company can still run, most recent first, as the list offers them. */
	const halfOptions = $derived(
		semiMonthly
			? companyPeriods(periodCandidates, 'SEMI_MONTHLY')
					.filter((candidate) => !isPeriodDisabled(candidate))
					.toReversed()
					.map((candidate) => ({
						value: candidate,
						label: halfLabel(candidate),
						search_term: `${candidate} ${halfLabel(candidate)}`
					}))
			: []
	);

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

<RecordShell
	title={record?.period ?? t('component.create_payroll_run')}
	subtitle={record
		? t('component.period_line', { period: record.period, count: payslipCount ?? 0 })
		: undefined}
>
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
							{formatCalendarInstant(record.attendance_from)} → {formatCalendarInstant(
								record.attendance_to
							)}
						</dd>
					</Stack>
					<Stack gap="xs">
						<dt class="text-meta">{t('app.payroll.pay_date')}</dt>
						<dd class="font-medium tabular-nums">{formatCalendarInstant(record.pay_date)}</dd>
					</Stack>
				</Grid>
			</Stack>

			{#if record.lifecycle === 'DRAFT'}
				<Stack gap="sm">
					<p class="text-sm text-muted-foreground">{t('payroll.frozen_hint')}</p>
					<CollectionForm
						{client}
						collection="payroll_runs"
						defaultValues={record}
						disabled={emptyDraft}
						submitLabel={t('payroll.mark_paid')}
						onAfterSubmit={close}
					>
						{#snippet children({ Field, form })}
							<Field name="company_id" hidden />
							<Field name="period" hidden />
							<Field name="lifecycle" hidden />
							<Field name="withheld" hidden />
							<p
								class="text-sm"
								{@attach () => {
									form.setValues({ lifecycle: 'PAID' });
								}}
							>
								{t('payroll.payment_confirmation')}
							</p>
						{/snippet}
					</CollectionForm>
				</Stack>
			{/if}
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
			defaultValues={scopedCompanyId == null ? undefined : { company_id: scopedCompanyId }}
		>
			{#snippet children({ form, Field })}
				<Field name="company_id" hidden />
				<Field name="period" hidden />
				<Field name="lifecycle" hidden />
				<!-- Declared unconditionally: the form must state every mutable field exactly once,
				     and the withhold section below only renders once an entity has been chosen. -->
				<Field name="withheld" hidden />
				<Stack gap="lg">
					<Grid gap="md" minimum="compact">
						{#if scopedCompanyId != null}
							<Stack gap="xs">
								<span class="text-meta">{t('component.legal_entity')}</span>
								<span class="font-medium">
									{companyOptions.find((option) => option.value === scopedCompanyId)?.label ?? '—'}
								</span>
							</Stack>
						{:else}
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
										disabled={companiesQuery.loading || settingsQuery.loading}
									/>
								</Stack>
							</label>
						{/if}
						<label class="text-sm font-medium">
							<Stack gap="xs">
								{t('component.pay_period')}
								{#if semiMonthly}
									<Combobox
										ariaLabel={t('component.pay_period')}
										options={halfOptions}
										value={period}
										onValueChange={(next) => {
											period = next;
											form.setValues({ company_id: companyId, period: next ?? undefined });
										}}
										searchPlaceholder={t('component.search_payroll_periods')}
										emptyPlaceholder={t('component.choose_payroll_period')}
										disabled={!companyId || runsQuery.loading}
									/>
								{:else}
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
								{/if}
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
					{#if companyId != null && (employmentsQuery?.current ?? []).length > 0}
						<Stack gap="sm">
							<Stack gap="xs">
								<Cluster align="center" gap="sm" justify="between">
									<span class="text-meta">{t('component.withhold_section')}</span>
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={allHeld}
											indeterminate={someHeld && !allHeld}
											onchange={(event) => {
												withheld = event.currentTarget.checked
													? Object.fromEntries(
															eligibleEmployments.map((employment) => [employment.id, ''])
														)
													: {};
												form.setValues({ withheld: withholdings });
											}}
										/>
										{t('component.withhold_select_all')}
									</label>
								</Cluster>
								<span class="text-sm text-muted-foreground">
									{t('component.withhold_hint')}
								</span>
							</Stack>
							<Cluster align="center" gap="sm">
								<CollectionToolbarQueryControls
									definition={collectionCatalog.employments}
									collections={collectionCatalog}
									onSearchChange={(search) => (personSearch = search)}
									onFilterChange={(filters) => (personFilters = filters)}
								/>
							</Cluster>
							<Stack gap="xs" class="max-h-64 overflow-y-auto">
								{#each visiblePeople as person (person.id)}
									{@const held = person.id in withheld}
									{@const done = alreadyRun.has(person.id)}
									<Stack gap="xs" class="shrink-0 {done ? 'opacity-60' : ''}">
										<label class="flex min-w-0 items-center gap-2 text-sm">
											<input
												type="checkbox"
												checked={held}
												disabled={done}
												onchange={(event) => {
													const { [person.id]: _dropped, ...rest } = withheld;
													withheld = event.currentTarget.checked
														? { ...rest, [person.id]: '' }
														: rest;
													form.setValues({ withheld: withholdings });
												}}
											/>
											<span class="tabular-nums">{person.employee_number}</span>
											<span class="truncate text-muted-foreground">{person.employee_name}</span>
										</label>
										{#if done}
											<span class="text-meta">{t('component.withhold_already_run')}</span>
										{:else if held}
											<input
												class="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm"
												placeholder={t('component.withhold_reason')}
												value={withheld[person.id]}
												oninput={(event) => {
													withheld = { ...withheld, [person.id]: event.currentTarget.value };
													form.setValues({ withheld: withholdings });
												}}
											/>
										{/if}
									</Stack>
								{/each}
							</Stack>
						</Stack>
					{/if}
					<p class="text-sm text-muted-foreground">
						{t('component.create_run_hint')}
					</p>
				</Stack>
			{/snippet}
		</CollectionForm>
	{/if}
</RecordShell>
