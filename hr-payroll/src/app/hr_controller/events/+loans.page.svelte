<script lang="ts">
	/** One legal entity's configured loans; generated repayments stay inside each loan. */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import Skeleton from '../../../lib/ui/components/skeleton.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import {
		companyScope,
		employmentNames,
		offerPageEntity
	} from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { versionMoney } from '../../../lib/ui/format/version_money.svelte.js';
	import { moneyNumber } from '../../../lib/payroll_engine/foundation.js';
	import { loanBalances } from '../../../lib/ui/payroll/loan_balance.js';

	const scope = offerPageEntity(companyScope());
	const person = employmentNames(() => scope.id);
	const money = versionMoney(() => {
		const lineage = scope.company?.settings_code;
		return lineage == null || lineage === '' ? null : { lineage };
	});
	const loans = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('loan_catalog_entry', {
					where: { company_id: { eq: scope.id } },
					select: {
						principal_amount: true,
						repayments: {
							select: { amount: true, activity: true, payslip_id: true },
							all: true
						}
					},
					all: true
				})
	);
	const balances = $derived(loanBalances(loans.current ?? []));
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet amountCell({ value }: { value: unknown })}{@const amount =
		moneyNumber(value)}{#if amount == null}—{:else}{money(amount)}{/if}{/snippet}
{#snippet balanceCell({ row }: { row: { readonly id: string }; value: unknown })}{@const left =
		balances.get(String(row.id))}{#if left == null}—{:else}{money(left)}{/if}{/snippet}

{#snippet companyControl()}<CompanyScope {scope} />{/snippet}

<AppShell
	icon="lucide:landmark"
	title={bolt.t('app.loans.title')}
	description={bolt.t('app.loans.description')}
>
	{#if scope.unknown}
		<Skeleton class="h-40 w-full" />
	{:else if scope.id == null}
		<EmptyState title={bolt.t('app.events.empty_scope')} />
	{:else}
		<Table
			of="loan_catalog_entry"
			key={`loans-${scope.id}`}
			where={{ company_id: { eq: scope.id } }}
			orderBy={{ created_at: 'desc' }}
			toolbar={{ title: bolt.t('app.loans.title'), controls: companyControl }}
			columns={[
				'catalog_id',
				{ field: 'employment_id', label: bolt.t('component.person'), cell: personCell },
				{ field: 'principal_amount', cell: amountCell },
				'repayment_period',
				'repayment_frequency',
				{ field: 'repayments', label: bolt.t('component.outstanding'), cell: balanceCell }
			]}
		/>
	{/if}
</AppShell>
