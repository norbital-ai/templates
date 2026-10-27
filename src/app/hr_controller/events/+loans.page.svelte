<script lang="ts">
	/** One legal entity's configured loans; generated repayments stay inside each loan. */
	import { bolt } from '$bolt';
	import type { Row } from '@norbital-ai/bolt';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import Skeleton from '../../../lib/ui/components/skeleton.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import {
		companyScope,
		employmentNames,
		offerPageEntity
	} from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { versionMoney } from '../../../lib/ui/format/version_money.svelte.js';
	import { loanBalances } from '../../../lib/ui/payroll/loan_balance.js';

	const scope = offerPageEntity(companyScope());
	const person = employmentNames(() => scope.id);
	const money = versionMoney(() => {
		const lineage = scope.company?.settings_code;
		return lineage == null || lineage === '' ? null : { lineage };
	});
	const loans = $derived.by(() =>
		scope.id == null
			? null
			: bolt.query({
					loan_catalog_entry: {
						where: { company_id: { eq: scope.id } },
						fields: ['principal_amount']
					},
					'loan_catalog_entry.repayments': { fields: ['amount', 'activity', 'payslip_id'] }
				})
	);
	const balances = $derived(loanBalances(loans?.current?.loan_catalog_entry.rows ?? []));
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet amountCell({
	value
}: {
	value: Row<'loan_catalog_entry'>['principal_amount'] | undefined;
})}{#if value instanceof Decimal}{money(value.toNumber())}{:else}—{/if}{/snippet}
{#snippet balanceCell({ row }: { row: { readonly id: string } })}{@const left = balances.get(
		row.id
	)}{#if left == null}—{:else}{money(left)}{/if}{/snippet}

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
