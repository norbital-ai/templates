<script lang="ts">
	/**
	 * Staff loans, salary advances, overpayment recoveries and third-party deduction orders of one legal entity: the
	 * agreement, and what its plan still has to recover. A repayment is recovered whole by the one payslip it links, and counts once that slip is
	 * paid: a draft has paid nobody.
	 */
	import ScopeGate from '../../../lib/ui/scopes/ScopeGate.svelte';
	import { t } from '../../../lib/ui/i18n/t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Combobox, Table } from '@norbital-ai/ui';
	import { repaymentProgress } from '../../../lib/loan-schedule.js';
	import CompanyScope from '../../../lib/ui/scopes/CompanyScope.svelte';
	import { companyScope, employmentNames } from '../../../lib/ui/scopes/company-scope.svelte.js';
	import { formatNumeric } from '../../../lib/ui/format/display-formatters.js';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { decodeNumber } from '../../../lib/payroll_engine/foundation/primitives.js';

	const scope = companyScope();
	const person = employmentNames(() => scope.id);
	let shown = $state<'outstanding' | 'closed' | 'all'>('outstanding');
	const agreements = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('loans', {
					where: {
						employment_id: { is: { approval_id: { isNull: true }, company_id: { eq: scope.id } } }
					},
					select: { principal: true },
					all: true
				})
	);
	const repayments = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('loan_repayments', {
					where: { loan_id: { is: { employment_id: { is: { company_id: { eq: scope.id } } } } } },
					select: {
						loan_id: true,
						sequence: true,
						amount_due: true,
						payslip_id: { select: { paid_at: true } }
					},
					orderBy: { sequence: 'asc' },
					all: true
				})
	);
	const byLoan = $derived(Map.groupBy(repayments.current ?? [], (row) => row.loan_id));
	type LoanRow = {
		readonly id: Id<'loans'>;
		readonly principal: unknown;
	};
	function balance(row: LoanRow) {
		const plan = byLoan.get(row.id) ?? [];
		const recovered = plan.reduce(
			(sum, row) => sum + (row.payslip_id?.paid_at != null ? row.amount_due : 0),
			0
		);
		// Principal remains owed until paid slips recover it, even before an order has its first repayment.
		return repaymentProgress(plan, recovered, decodeNumber(row.principal));
	}
	const agreementIds = $derived(
		(agreements.current ?? [])
			.filter(
				(row) =>
					shown === 'all' ||
					(shown === 'closed' ? balance(row)?.settled === true : balance(row)?.settled !== true)
			)
			.map((row) => row.id)
	);
	function progress(row: LoanRow): string {
		const p = balance(row);
		if (p == null) return '—';
		return p.settled
			? t('app.loans.progress_settled', { paid: p.paidRepayments, total: p.totalRepayments })
			: t('app.loans.progress_partial', {
					outstanding: formatNumeric(p.outstandingAmount),
					paid: p.paidRepayments,
					total: p.totalRepayments
				});
	}
</script>

{#snippet agreementFilter()}
	<Combobox
		value={shown}
		options={[
			{ value: 'outstanding', label: t('app.loans.filter_outstanding') },
			{ value: 'closed', label: t('app.loans.filter_closed') },
			{ value: 'all', label: t('app.loans.filter_all') }
		]}
		aria-label={t('app.loans.view')}
		onChange={(value) => {
			if (value === 'outstanding' || value === 'closed' || value === 'all') shown = value;
		}}
	/>
{/snippet}

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet progressCell({ row }: { row: LoanRow })}{progress(row)}{/snippet}

<AppShell
	icon="lucide:landmark"
	title={t('app.loans.title')}
	description={t('app.loans.description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	<ScopeGate {scope} empty={t('app.loans.empty')}>
		{#snippet children(id)}
			{#key id}
				{#if agreements.error || repayments.error}
					<p role="alert" class="text-destructive text-sm">
						{agreements.error ?? repayments.error}
					</p>
				{:else if agreements.loading || repayments.loading}
					<p role="status" class="text-meta">{t('component.loading')}</p>
				{:else}
					<Table
						of="loans"
						key={`loans-${id}-${shown}`}
						toolbar={{ title: t('app.loans.agreements'), controls: agreementFilter }}
						where={{
							employment_id: { is: { approval_id: { isNull: true }, company_id: { eq: id } } },
							id: { in: agreementIds }
						}}
						orderBy={{ effective_from: 'desc' }}
						columns={[
							'reference',
							{ field: 'employment_id', label: t('component.employment'), cell: personCell },
							{ field: 'loan_catalogue_id', label: t('app.loans.deducted_as') },
							{ field: 'principal', label: t('app.loans.principal') },
							{ field: 'id', label: t('app.loans.outstanding'), cell: progressCell },
							{ field: 'effective_range', label: t('component.effective_period') }
						]}
					/>
				{/if}
			{/key}
		{/snippet}
	</ScopeGate>
</AppShell>
