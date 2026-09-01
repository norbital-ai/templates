<script lang="ts">
	/**
	 * Staff loans, salary advances and overpayment recoveries — the agreement, and the plan it owns.
	 *
	 * ## What is stored, and what is derived
	 *
	 * The loan is the agreement; the amounts due under it are `loan_repayments` rows, which is what
	 * payroll consumes. What has been recovered is the sum of what paid runs actually took, read off
	 * the recovery adjustments through the repayment-capture junction — not a per-master link.
	 *
	 * `paidRepayments` is DERIVED here rather than counted: repayments are recovered in the order
	 * they are scheduled, so the number settled is the number of leading repayments the recovered
	 * total covers. That is faithful to how the engine recovers — `measure.ts` takes every repayment
	 * due on or before the period and nets off what earlier runs already recovered — and it is
	 * stated as a derivation rather than presented as a stored fact.
	 *
	 * Only PAID runs count. A draft run has produced adjustments and paid nobody, and showing its
	 * figures as recovered would report a loan as settled before the money moved.
	 */
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../lib/workspace-client.js';
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Bound, Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import { formatEffectiveRange, formatNumeric } from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant } from '../../lib/ui/calendar.js';

	const { t } = useI18n<TenantI18nKeys>();

	const RepaymentProgressSchema = Schema.Struct({
		recoveredAmount: Schema.Number,
		outstandingAmount: Schema.Number,
		paidRepayments: Schema.Number,
		totalRepayments: Schema.Number,
		settled: Schema.Boolean
	});
	type RepaymentProgress = Schema.Schema.Type<typeof RepaymentProgressSchema>;

	/**
	 * How far a schedule has been recovered, from the principal and what paid runs took.
	 *
	 * The tolerance mirrors `overRecoversRepayment` in `src/lib/settlement_refusals.ts`: amounts are
	 * rounded to the currency's minor unit on the way into a payslip, so a schedule that sums to its
	 * principal exactly can land a hundredth either side of it across a dozen runs.
	 */
	/**
	 * How far a schedule has been recovered, from the plan and what paid runs took.
	 *
	 * The tolerance mirrors `overRecoversRepayment` in `src/lib/settlement_refusals.ts`: amounts are
	 * rounded to the currency's minor unit on the way into a payslip, so a schedule that sums to its
	 * principal exactly can land a hundredth either side of it across a dozen runs.
	 */
	function repaymentProgress(
		repayments: readonly { readonly amount_due: unknown }[],
		recoveredAmount: number
	): RepaymentProgress | null {
		const principal = repayments.reduce((total, row) => total + Number(row.amount_due), 0);
		if (!Number.isFinite(principal) || principal < 0) return null;
		const outstandingAmount = Math.max(0, principal - recoveredAmount);
		let covered = 0;
		let paidRepayments = 0;
		for (const repayment of repayments) {
			covered += Number(repayment.amount_due);
			if (covered - recoveredAmount > 0.01) break;
			paidRepayments += 1;
		}
		return {
			recoveredAmount,
			outstandingAmount,
			paidRepayments,
			totalRepayments: repayments.length,
			settled: outstandingAmount <= 0.01
		};
	}

	let companyId = $state<string | null>(null);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;

	/**
	 * The ledger opens on the loans still running today, as a filter chip the operator can drop
	 * to see settled and future ones. The legal-entity selector keeps `activeRange` in its own query
	 * regardless: that is the page's scope picker, not a listing, and it has to default to an entity
	 * that still exists.
	 */
	const companiesQuery = $derived(
		client.db.companies.findMany({
			where: { approval_id: { isNull: true }, ...activeRange },
			orderBy: { name: 'asc' },
			limit: 500
		})
	);
	const companies = $derived(companiesQuery.current ?? []);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	const selectedCompanyId = $derived(
		companyId != null && companies.some((c) => c.id === companyId)
			? companyId
			: (companies[0]?.id ?? null)
	);

	/**
	 * The recovery ledger, in three reads rather than a nested one.
	 *
	 * `payslip_adjustments.input` is a `reference(...)` to the repayment-input junction, so the
	 * repayment ids are read first and the claims scoped by them — the same shape every other
	 * settlement lookup in this workspace uses, and bounded by the company rather than by the whole
	 * ledger. The loans table carries the plan's count; the repayments carry their amounts.
	 */
	const loansQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.loans.findMany({
					where: {
						loan_employment: {
							some: {
								approval_id: { isNull: true },
								company_id: { eq: selectedCompanyId }
							}
						}
					},
					columns: { id: true },
					orderBy: { effective_range: 'desc' },
					limit: 1000
				})
	);
	const repaymentsQuery = $derived.by(() => {
		const ids = (loansQuery?.current ?? []).map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.loan_repayments.findMany({
			where: { loan_id: { in: ids } },
			columns: { id: true, loan_id: true, amount_due: true, sequence: true },
			limit: 1000
		});
	});
	const repaymentsByLoanId = $derived.by(() => {
		const byLoan = new Map<string, { readonly id: string; readonly amount_due: unknown }[]>();
		for (const row of repaymentsQuery?.current ?? []) {
			const bucket = byLoan.get(row.loan_id) ?? [];
			bucket.push(row);
			byLoan.set(row.loan_id, bucket);
		}
		return byLoan;
	});
	const recoveriesQuery = $derived.by(() => {
		const ids = (repaymentsQuery?.current ?? []).map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.payslip_adjustments.findMany({
			where: {
				input: { in: ids.map((id) => ({ kind: 'LOAN_REPAYMENT_INPUT' as const, id })) }
			},
			columns: { input: true, amount: true },
			with: {
				payslip_adjustment_payslip: {
					columns: { id: true },
					with: { payslip_payroll_run: { columns: { lifecycle: true } } }
				}
			},
			limit: 1000
		});
	});

	const recoveryRowSchema = Schema.Struct({
		amount: Schema.Unknown,
		input: Schema.Struct({ kind: Schema.String, id: Schema.String }),
		payslip_adjustment_payslip: Schema.optional(
			Schema.NullOr(
				Schema.Struct({
					payslip_payroll_run: Schema.optional(
						Schema.NullOr(
							Schema.Struct({ lifecycle: Schema.optional(Schema.NullOr(Schema.String)) })
						)
					)
				})
			)
		)
	});
	const decodeRecoveryRow = Schema.decodeUnknownResult(recoveryRowSchema);

	const recoveredByRepaymentId = $derived.by(() => {
		const recovered = new Map<string, number>();
		for (const row of recoveriesQuery?.current ?? []) {
			const parsed = decodeRecoveryRow(row);
			if (!Result.isSuccess(parsed)) continue;
			const claim = parsed.success;
			if (claim.input.kind !== 'LOAN_REPAYMENT_INPUT') continue;
			if (claim.payslip_adjustment_payslip?.payslip_payroll_run?.lifecycle !== 'PAID') continue;
			const amount = Number(claim.amount);
			if (!Number.isFinite(amount)) continue;
			recovered.set(claim.input.id, (recovered.get(claim.input.id) ?? 0) + amount);
		}
		return recovered;
	});

	type NestedLoan = WorkspaceRow<'loans'> & {
		readonly loan_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly loan_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
	};

	function progressLabel(row: NestedLoan): string {
		const progress = repaymentProgress(
			repaymentsByLoanId.get(row.id) ?? [],
			[...(repaymentsByLoanId.get(row.id) ?? [])].reduce(
				(total, repayment) => total + (recoveredByRepaymentId.get(repayment.id) ?? 0),
				0
			)
		);
		if (progress == null) return '—';
		if (progress.settled)
			return t('app.loans.progress_settled', {
				paid: progress.paidRepayments,
				total: progress.totalRepayments
			});
		return t('app.loans.progress_partial', {
			outstanding: formatNumeric(progress.outstandingAmount),
			paid: progress.paidRepayments,
			total: progress.totalRepayments
		});
	}

	function componentLabel(row: NestedLoan): string {
		const component = row.loan_pay_component;
		if (component?.code) return component.code;
		return '—';
	}
</script>

<svelte:head>
	<title>Loans</title>
	<meta
		name="description"
		content="Review staff loans, salary advances, and overpayment recoveries with their derived outstanding balance"
	/>
	<meta name="bolt:icon" content="lucide:hand-coins" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/loans-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/loans-banner.webp"
	/>
</svelte:head>

{#snippet companyScopeActions()}
	<Combobox
		ariaLabel={t('component.legal_entity')}
		options={companyOptions}
		value={selectedCompanyId}
		onValueChange={(value) => {
			if (typeof value === 'string') {
				companyId = value;
				return;
			}
			companyId = companies[0]?.id ?? null;
		}}
		emptyPlaceholder={t('component.select_legal_entity')}
		searchPlaceholder={t('component.search_companies')}
		clientConfig={{
			isLoading: companiesQuery.loading,
			error: companiesQuery.error?.message ?? null
		}}
		class="min-w-[16rem]"
	/>
{/snippet}

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<Cover>
	<Bound size="full" inset>
		{#if selectedCompanyId == null}
			<p class="text-sm text-muted-foreground">
				{t('app.loans.empty')}
			</p>
		{:else}
			{#key selectedCompanyId}
				<CollectionTable
					{client}
					collection="loans"
					view={`hr_controller:loans:${selectedCompanyId}`}
					title={t('app.loans.agreements')}
					description={t('app.loans.agreements_description')}
					initialFilters={inForceTodayFilter()}
					query={{
						where: {
							loan_employment: {
								some: {
									approval_id: { isNull: true },
									company_id: { eq: selectedCompanyId }
								}
							}
						},
						orderBy: { effective_range: 'desc' },
						with: {
							loan_employment: { columns: { employee_number: true } },
							loan_pay_component: { columns: { code: true } }
						}
					}}
				>
					{#snippet columns({ Column })}
						<Column name="reference" card="title" />
						<Column
							name="employment_id"
							label={t('component.employment')}
							card="subtitle"
							renderer={FormattedValueRenderer}
							rendererProps={{
								format: ({ row }: { row: NestedLoan }) =>
									row.loan_employment?.employee_number ?? '—'
							}}
						/>
						<Column
							name="pay_component_id"
							label={t('app.loans.deducted_as')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => componentLabel(row) }}
						/>
						<Column name="principal" label={t('app.loans.principal_outstanding')} />
						<Column name="effective_range" />
					{/snippet}
					{#snippet ListCard(loan)}
						<Stack gap="xs">
							<Inline align="start" justify="between" gap="sm">
								<p class="truncate font-medium">{loan.reference ?? '—'}</p>
								<span class="shrink-0 text-meta">
									{formatEffectiveRange(loan.effective_range)}
								</span>
							</Inline>
							<p class="text-sm">{progressLabel(loan)}</p>
						</Stack>
					{/snippet}
				</CollectionTable>
			{/key}
		{/if}
	</Bound>
</Cover>
