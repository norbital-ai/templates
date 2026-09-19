<script lang="ts">
	/**
	 * Staff loans, salary advances and overpayment recoveries — the agreement, and the plan it owns.
	 *
	 * ## What is stored, and what is derived
	 *
	 * The loan is the agreement; the amounts due under it are `loan_repayments` rows, which is what
	 * payroll consumes. A repayment is recovered whole by the one payslip its `payslip_id` names, and
	 * it counts as recovered once that slip is paid: a draft has paid nobody, and showing its rows as
	 * recovered would report a loan as settled before the money moved.
	 */
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import { client } from '../../../lib/workspace-client.js';

	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import CompanyScopeCombobox from '../CompanyScopeCombobox.svelte';
	import {
		companiesUnknown as companiesUnknownOf,
		companyById,
		resolveCompanyId
	} from '../company-scope.svelte.js';
	import { setContext } from 'svelte';
	import {
		componentLabel,
		EMPLOYMENT_LABEL_WITH,
		employmentLabel,
		HR_CREATE_SCOPE,
		type HrCreateScope
	} from '../../../lib/ui/create-scope.js';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { formatEffectiveRange, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { inForceTodayFilter } from '../../../lib/ui/calendar.js';
	import { decodeNumber } from '@norbital-ai/std/json';
	import { repaymentProgress } from '../../../lib/loan-schedule.js';
	import EffectiveRangeRenderer from '../../../lib/ui/effective-range-renderer.svelte';

	const { t } = useI18n<TenantI18nKeys>();

	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	/**
	 * The scope the create forms this page opens are drawn against: this entity's own people, and
	 * the catalogue version its jurisdiction lineage has in force. Without it a form opened from
	 * this page offers every employment in the workspace and every version of every catalogue row.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	/**
	 * The recovery ledger, in three reads rather than a nested one.
	 *
	 * The payslip's adjustments name the repayment by family and source id, so the
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
					orderBy: { effective_from: 'desc' },
					limit: 10_000
				})
	);
	const repaymentsQuery = $derived.by(() => {
		const ids = (loansQuery?.current ?? []).map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.loan_repayments.findMany({
			where: { loan_id: { in: ids } },
			columns: { id: true, loan_id: true, amount_due: true, sequence: true, payslip_id: true },
			limit: 10_000
		});
	});
	const repaymentsByLoanId = $derived.by(() => {
		const grouped: Record<string, { readonly id: string; readonly amount_due: unknown }[]> = {};
		for (const row of repaymentsQuery?.current ?? []) {
			(grouped[row.loan_id] ??= []).push(row);
		}
		return new Map(Object.entries(grouped));
	});
	const recoveriesQuery = $derived.by(() => {
		const ids = [
			...new Set(
				(repaymentsQuery?.current ?? []).flatMap((row) =>
					row.payslip_id == null ? [] : [row.payslip_id]
				)
			)
		];
		if (ids.length === 0) return null;
		// The slip's own payment, not its run's summary: a repayment is recovered whole by the one
		// slip it links, and it counts once that slip is paid.
		return client.db.payslips.findMany({
			where: { id: { in: ids }, paid_at: { isNotNull: true } },
			columns: { id: true },
			limit: 10_000
		});
	});

	const recoveredByRepaymentId = $derived.by(() => {
		const paidSlips = new Set((recoveriesQuery?.current ?? []).map((row) => String(row.id)));
		return new Map(
			(repaymentsQuery?.current ?? []).flatMap((row) =>
				row.payslip_id != null && paidSlips.has(String(row.payslip_id))
					? [[row.id, decodeNumber(row.amount_due)] as const]
					: []
			)
		);
	});

	type NestedLoan = WorkspaceRow<'loans'> & {
		readonly loan_employment?:
			| (Pick<WorkspaceRow<'employments'>, 'employee_number'> & {
					readonly employment_employee?: { readonly name: string } | null;
			  })
			| null;
		readonly loan_loan_catalogue?: Pick<WorkspaceRow<'loan_catalogue'>, 'code' | 'name'> | null;
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
</script>

{#snippet companyScopeActions()}
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
{/snippet}

<AppShell
	icon="lucide:hand-coins"
	title="Loans"
	description="Review staff loans, salary advances, and overpayment recoveries with their derived outstanding balance"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/loans-banner.webp"
>
	<AppHeaderActions>
		{@render companyScopeActions()}
	</AppHeaderActions>

	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">
			{t('app.loans.empty')}
		</p>
	{:else}
		{#key selectedCompanyId}
			{@render agreements()}
		{/key}
	{/if}
</AppShell>

{#snippet agreements()}
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
			orderBy: { effective_from: 'desc' },
			with: {
				loan_employment: EMPLOYMENT_LABEL_WITH,
				loan_loan_catalogue: { columns: { code: true, name: true } }
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
					format: ({ row }: { row: NestedLoan }) => employmentLabel(row.loan_employment)
				}}
			/>
			<Column
				name="loan_catalogue_id"
				label={t('app.loans.deducted_as')}
				renderer={FormattedValueRenderer}
				rendererProps={{
					format: ({ row }: { row: NestedLoan }) => componentLabel(row.loan_loan_catalogue)
				}}
			/>
			<Column name="principal" label={t('app.loans.principal')} />
			<!-- What is still to recover, and how many instalments have been: the column the header promised. -->
			<Column
				name="effective_from"
				label={t('app.loans.outstanding')}
				renderer={FormattedValueRenderer}
				rendererProps={{ format: ({ row }: { row: NestedLoan }) => progressLabel(row) }}
			/>
			<Column
				name="effective_range"
				label={t('component.effective_period')}
				renderer={EffectiveRangeRenderer}
			/>
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
{/snippet}
