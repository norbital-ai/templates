<script lang="ts">
	/**
	 * Staff loans, salary advances and overpayment recoveries — the SCHEDULED arm of `obligations`.
	 *
	 * ## What is no longer stored, and what replaces it
	 *
	 * A loan used to be a `repayment_agreements` row whose instalments were COPIED into
	 * `component_entries` as `LOAN_INSTALMENT` rows, so this page could ask "which instalments have
	 * a payslip line pointing at them" and count them. Those rows do not exist. The schedule holds
	 * its own instalments as an inline array, and what has been recovered is the sum of what paid
	 * runs actually took from the obligation — which is one read of `payslip_adjustments` against
	 * the obligation, not a per-instalment link.
	 *
	 * So `paidInstalments` is DERIVED here rather than counted: instalments are recovered in the
	 * order they are listed, so the number settled is the number of leading instalments the
	 * recovered total covers. That is faithful to how the engine recovers — `measure.ts` takes every
	 * instalment due on or before the period and nets off what earlier runs already took — and it is
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
	import {
		formatEffectiveRange,
		formatInstalments,
		formatNumeric
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant } from '../../lib/ui/calendar.js';

	const { t } = useI18n<TenantI18nKeys>();

	const RepaymentProgressSchema = Schema.Struct({
		recoveredAmount: Schema.Number,
		outstandingAmount: Schema.Number,
		paidInstalments: Schema.Number,
		totalInstalments: Schema.Number,
		settled: Schema.Boolean
	});
	type RepaymentProgress = Schema.Schema.Type<typeof RepaymentProgressSchema>;

	/**
	 * How far a schedule has been recovered, from the principal and what paid runs took.
	 *
	 * The tolerance mirrors `overConsumesObligation` in `src/lib/settlement_refusals.ts`: amounts are
	 * rounded to the currency's minor unit on the way into a payslip, so a schedule that sums to its
	 * principal exactly can land a hundredth either side of it across a dozen runs.
	 */
	function repaymentProgress(
		principal: number,
		instalments: readonly { readonly amount: number }[],
		recoveredAmount: number
	): RepaymentProgress | null {
		if (!Number.isFinite(principal) || principal < 0) return null;
		const outstandingAmount = Math.max(0, principal - recoveredAmount);
		let covered = 0;
		let paidInstalments = 0;
		for (const instalment of instalments) {
			covered += instalment.amount;
			if (covered - recoveredAmount > 0.01) break;
			paidInstalments += 1;
		}
		return {
			recoveredAmount,
			outstandingAmount,
			paidInstalments,
			totalInstalments: instalments.length,
			settled: outstandingAmount <= 0.01
		};
	}

	let companyId = $state<string | null>(null);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;

	/**
	 * The ledger opens on the obligations still running today, as a filter chip the operator can drop
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
	 * The recovery ledger, in two reads rather than a nested one.
	 *
	 * `payslip_adjustments.source` is a `reference(...)`, so the edge is owned by the reference and
	 * there is no `many` inverse to nest under an obligation. The ids are therefore read first and
	 * the claims scoped by them — the same shape every other settlement lookup in this workspace
	 * uses, and bounded by the company rather than by the whole ledger.
	 */
	const scheduledIdsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.obligations.findMany({
					where: {
						terms: { eq: 'SCHEDULED' },
						obligation_employment: {
							approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						}
					},
					columns: { id: true },
					limit: 2000
				})
	);
	const recoveriesQuery = $derived.by(() => {
		const ids = (scheduledIdsQuery?.current ?? []).map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.payslip_adjustments.findMany({
			where: { source: { in: ids.map((id) => ({ kind: 'OBLIGATION' as const, id })) } },
			columns: { source: true, amount: true },
			with: {
				payslip_adjustment_payslip: {
					columns: { id: true },
					with: { payslip_payroll_run: { columns: { lifecycle: true } } }
				}
			},
			limit: 20_000
		});
	});

	const recoveryRowSchema = Schema.Struct({
		amount: Schema.Unknown,
		source: Schema.Struct({ kind: Schema.String, id: Schema.String }),
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

	const recoveredByObligationId = $derived.by(() => {
		const recovered = new Map<string, number>();
		for (const row of recoveriesQuery?.current ?? []) {
			const parsed = decodeRecoveryRow(row);
			if (!Result.isSuccess(parsed)) continue;
			const claim = parsed.success;
			if (claim.source.kind !== 'OBLIGATION') continue;
			if (claim.payslip_adjustment_payslip?.payslip_payroll_run?.lifecycle !== 'PAID') continue;
			const amount = Number(claim.amount);
			if (!Number.isFinite(amount)) continue;
			recovered.set(claim.source.id, (recovered.get(claim.source.id) ?? 0) + amount);
		}
		return recovered;
	});

	type NestedObligation = WorkspaceRow<'obligations'> & {
		readonly obligation_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly obligation_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
	};

	function progressLabel(row: NestedObligation): string {
		const progress = repaymentProgress(
			Number(row.amount),
			row.instalments ?? [],
			recoveredByObligationId.get(row.id) ?? 0
		);
		if (progress == null) return '—';
		if (progress.settled)
			return t('app.loans.progress_settled', {
				paid: progress.paidInstalments,
				total: progress.totalInstalments
			});
		return t('app.loans.progress_partial', {
			outstanding: formatNumeric(progress.outstandingAmount),
			paid: progress.paidInstalments,
			total: progress.totalInstalments
		});
	}

	function componentLabel(row: NestedObligation): string {
		const component = row.obligation_pay_component;
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
					collection="obligations"
					view={`hr_controller:loans:${selectedCompanyId}`}
					title={t('app.loans.agreements')}
					description={t('app.loans.agreements_description')}
					initialFilters={inForceTodayFilter()}
					query={{
						where: {
							terms: { eq: 'SCHEDULED' },
							obligation_employment: {
								approval_id: { isNull: true },
								company_id: { eq: selectedCompanyId }
							}
						},
						orderBy: { effective_range: 'desc' },
						with: {
							obligation_employment: { columns: { employee_number: true } },
							obligation_pay_component: { columns: { code: true } }
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
								format: ({ row }: { row: NestedObligation }) =>
									row.obligation_employment?.employee_number ?? '—'
							}}
						/>
						<Column
							name="pay_component_id"
							label={t('app.loans.deducted_as')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ row }) => componentLabel(row) }}
						/>
						<Column name="amount" label={t('app.loans.principal_outstanding')} />
						<Column
							name="instalments"
							label={t('component.recovery_instalments')}
							renderer={FormattedValueRenderer}
							rendererProps={{ format: ({ value }) => formatInstalments(value, t) }}
						/>
						<Column name="effective_range" />
					{/snippet}
					{#snippet ListCard(obligation)}
						<Stack gap="xs">
							<Inline align="start" justify="between" gap="sm">
								<p class="truncate font-medium">{obligation.reference}</p>
								<span class="shrink-0 text-meta">
									{formatEffectiveRange(obligation.effective_range)}
								</span>
							</Inline>
							<p class="truncate text-sm text-muted-foreground">
								{formatInstalments(obligation.instalments, t)}
							</p>
							<p class="text-sm">{progressLabel(obligation)}</p>
						</Stack>
					{/snippet}
				</CollectionTable>
			{/key}
		{/if}
	</Bound>
</Cover>
