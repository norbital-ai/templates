<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Bound, Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		formatEffectiveRange,
		formatNumeric,
		formatRepaymentSchedule
	} from '../../lib/ui/display-formatters.js';
	import { inForceTodayFilter, todayInstant } from '../../lib/ui/calendar.js';

	type RepaymentInstalmentLink = Pick<
		WorkspaceRow<'component_entries'>,
		'amount' | 'repayment_sequence'
	> & {
		readonly entry_payslip_lines?: readonly Pick<WorkspaceRow<'payslip_lines'>, 'id'>[] | null;
	};

	const RepaymentProgressSchema = Schema.Struct({
		paidAmount: Schema.Number,
		outstandingAmount: Schema.Number,
		paidInstalments: Schema.Number,
		totalInstalments: Schema.Number,
		settled: Schema.Boolean
	});
	type RepaymentProgress = Schema.Schema.Type<typeof RepaymentProgressSchema>;

	function repaymentProgress(
		principal: number,
		totalInstalments: number,
		instalments: readonly RepaymentInstalmentLink[]
	): RepaymentProgress | null {
		if (!Number.isFinite(principal) || principal < 0) return null;

		const paidBySequence = new Map<number, number>();
		for (const instalment of instalments) {
			if (!instalment.entry_payslip_lines?.length) continue;
			const sequence = instalment.repayment_sequence;
			if (typeof sequence !== 'number' || !Number.isInteger(sequence)) continue;
			const amount = Number(instalment.amount);
			if (!Number.isFinite(amount) || amount < 0) continue;
			if (!paidBySequence.has(sequence)) paidBySequence.set(sequence, amount);
		}

		const paidAmount = [...paidBySequence.values()].reduce((sum, amount) => sum + amount, 0);
		const outstandingAmount = Math.max(0, principal - paidAmount);
		const paidInstalments = paidBySequence.size;
		return {
			paidAmount,
			outstandingAmount,
			paidInstalments,
			totalInstalments,
			settled: outstandingAmount === 0 && paidInstalments >= totalInstalments
		};
	}

	const { t } = useI18n<TenantI18nKeys>();

	let companyId = $state<string | null>(null);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;

	/**
	 * The ledger opens on the agreements still running today, as a filter chip the operator can drop
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
	 * There is no mutable `state` or `outstanding` column. The table asks for each agreement and its
	 * direct relations in one nested query; an instalment is paid once a persisted payslip line
	 * points back to it.
	 */
	type NestedAgreement = WorkspaceRow<'repayment_agreements'> & {
		readonly agreement_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly agreement_pay_component?: Pick<WorkspaceRow<'pay_components'>, 'code'> | null;
		readonly agreement_instalments?: readonly RepaymentInstalmentLink[] | null;
	};

	function progressLabel(row: NestedAgreement): string {
		const progress = repaymentProgress(
			row.principal,
			row.schedule.length,
			row.agreement_instalments ?? []
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

	function componentLabel(row: NestedAgreement): string {
		const component = row.agreement_pay_component;
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
					collection="repayment_agreements"
					view={`hr_controller:loans:${selectedCompanyId}`}
					title={t('app.loans.repayment_agreements')}
					description={t('app.loans.repayment_agreements_description')}
					initialFilters={inForceTodayFilter()}
					query={{
						where: {
							agreement_employment: {
								approval_id: { isNull: true },
								company_id: { eq: selectedCompanyId }
							}
						},
						orderBy: { effective_range: 'desc' },
						with: {
							agreement_employment: { columns: { employee_number: true } },
							agreement_pay_component: { columns: { code: true } },
							agreement_instalments: {
								where: { approval_id: { isNull: true } },
								columns: { amount: true, repayment_sequence: true },
								with: {
									entry_payslip_lines: { columns: { id: true } }
								}
							}
						}
					}}
				>
					{#snippet columns({ Column })}
						<Column name="reference" card="title" />
						<Column
							name="employment_id"
							label={t('component.employment')}
							card="subtitle"
							render={({ row }: { row: NestedAgreement }) =>
								row.agreement_employment?.employee_number ?? '—'}
						/>
						<Column
							name="pay_component_id"
							label={t('app.loans.deducted_as')}
							render={({ row }) => componentLabel(row)}
						/>
						<Column
							name="principal"
							label={t('app.loans.principal_outstanding')}
							render={({ row, value }) => `${formatNumeric(value)} · ${progressLabel(row)}`}
						/>
						<Column
							name="schedule"
							label={t('component.schedule')}
							render={({ value }) => formatRepaymentSchedule(value, t)}
						/>
						<Column name="effective_range" />
					{/snippet}
					{#snippet ListCard(agreement)}
						<Stack gap="xs">
							<Inline align="start" justify="between" gap="sm">
								<p class="truncate font-medium">{agreement.reference}</p>
								<span class="shrink-0 text-meta">
									{formatEffectiveRange(agreement.effective_range)}
								</span>
							</Inline>
							<p class="truncate text-sm text-muted-foreground">
								{formatRepaymentSchedule(agreement.schedule, t)}
							</p>
							<p class="text-sm">{progressLabel(agreement)}</p>
						</Stack>
					{/snippet}
				</CollectionTable>
			{/key}
		{/if}
	</Bound>
</Cover>
