<script lang="ts">
	/**
	 * Staff loans, salary advances, overpayment recoveries and third-party deduction orders of one legal entity: the
	 * agreement, and what its plan still has to recover. A repayment is recovered whole by the one payslip it links, and counts once that slip is
	 * paid: a draft has paid nobody.
	 */
	import ScopeGate from '../../../lib/ui/ScopeGate.svelte';
	import { t } from '../../../lib/ui/t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import { repaymentProgress } from '../../../lib/loan-schedule.js';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import { companyScope, employmentNames } from '../../../lib/ui/company-scope.svelte.js';
	import { formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';

	const scope = companyScope();
	const person = employmentNames(() => scope.id);
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
		readonly recovery_rule: string | null;
	};
	function progress(row: LoanRow): string {
		const plan = byLoan.get(row.id) ?? [];
		const recovered = plan.reduce(
			(sum, row) => sum + (row.payslip_id?.paid_at != null ? row.amount_due : 0),
			0
		);
		// A rule-recovered order's rows are what payroll withheld, not a plan summing to the principal.
		const p = repaymentProgress(
			plan,
			recovered,
			(row.recovery_rule ?? '').trim() !== '' ? decodeNumber(row.principal) : undefined
		);
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
				<Table
					of="loans"
					key={`loans-${id}`}
					toolbar={{ title: t('app.loans.agreements') }}
					where={{
						employment_id: { is: { approval_id: { isNull: true }, company_id: { eq: id } } }
					}}
					initialFilter={{ effective_range: { contains: { today: '' } } }}
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
			{/key}
		{/snippet}
	</ScopeGate>
</AppShell>
