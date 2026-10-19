<script lang="ts">
	/**
	 * One legal entity's captured catalogue entries of one family (claims, ad hoc payments, leave, loans) for one
	 * pay period: the entries whose own date falls inside the entity's window, and the payslip that captured each.
	 * An entry already pinned to a payslip is settled; the payroll automation, not this screen, moves it.
	 */
	import { t } from '../i18n/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import Skeleton from '../components/skeleton.svelte';
	import CompanyScope from '../scopes/company_picker.svelte';
	import {
		companyScope,
		employmentNames,
		offerPageEntity
	} from '../scopes/company_scope.svelte.js';
	import MonthPeriodPicker from '../components/month_period_picker.svelte';
	import { createPayPeriodScope } from '../scopes/pay_period_scope.svelte.js';
	import { versionMoney } from '../format/version_money.svelte.js';
	import { moneyNumber } from '../../payroll_engine/foundation.js';
	import { bolt } from '$bolt';
	import { liveRows } from '../state/live.svelte.js';
	import { loanBalances } from './loan_balance.js';

	/** The four captured-entry families, all one shape: reference, occurred_on, amount, catalog_id. */
	type EntryCollection =
		'adhoc_catalog_entry' | 'claim_catalog_entry' | 'leave_catalog_entry' | 'loan_catalog_entry';

	let {
		collection,
		dateLabel,
		title,
		description,
		icon
	}: {
		collection: EntryCollection;
		dateLabel: string;
		title: string;
		description: string;
		icon: string;
	} = $props();
	const scope = offerPageEntity(companyScope());
	const pay = createPayPeriodScope(() => scope.company);
	const person = employmentNames(() => scope.id);
	const money = versionMoney(() => {
		const lineage = scope.company?.settings_code;
		return lineage == null || lineage === '' ? null : { lineage };
	});
	/** Loans: every instalment of the entity's loans, read once, for each one's outstanding balance. */
	const instalments = liveRows(() =>
		collection !== 'loan_catalog_entry' || scope.id == null
			? null
			: bolt.read('loan_catalog_entry', {
					where: { employment_id: { is: { company_id: { eq: scope.id } } } },
					select: {
						employment_id: true,
						catalog_id: true,
						occurred_on: true,
						activity: true,
						amount: true,
						facts: true
					},
					all: true
				})
	);
	const balances = $derived(loanBalances(instalments.current ?? []));
</script>

{#snippet balanceCell({ row }: { row: { readonly id: string }; value: unknown })}{@const left =
		balances.get(String(row.id))}{#if left == null}
		—
	{:else}
		{money(left)}
	{/if}{/snippet}

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet amountCell({ value }: { value: unknown })}{@const amount =
		moneyNumber(value)}{#if amount == null}
		—
	{:else}
		{money(amount)}
	{/if}{/snippet}

<AppShell {icon} {title} {description}>
	{#snippet actions()}
		<MonthPeriodPicker
			month={pay.period}
			halves={pay.halves}
			weeks={pay.weeks}
			ariaLabel={t('app.events.pay_period')}
			onMonthChange={(next) => pay.select(next)}
		/>
		<CompanyScope {scope} />
	{/snippet}
	{#if scope.unknown}
		<Skeleton class="h-40 w-full" />
	{:else if scope.id == null}
		<EmptyState title={t('app.events.empty_scope')} />
	{:else if pay.window != null}
		{#key `${scope.id}:${pay.period}`}
			{@const where = {
				employment_id: { is: { company_id: { eq: scope.id } } },
				occurred_on: { gte: pay.window.start, lte: pay.window.end }
			} as const}
			<!-- repository-health:allow UI17 -- the tables' `key`, never shown -->
			{@const key = `${collection}-${scope.id}-${pay.period}`}
			<Table
				of={collection}
				{key}
				toolbar={{ title }}
				{where}
				orderBy={{ occurred_on: 'desc' }}
				columns={[
					{ field: 'catalog_id', label: t('component.component') },
					{ field: 'employment_id', label: t('component.person'), cell: personCell },
					{ field: 'amount', label: t('component.amount'), cell: amountCell },
					{ field: 'occurred_on', label: dateLabel },
					{ field: 'reference', label: t('component.reference') },
					...(collection === 'loan_catalog_entry'
						? [{ field: 'facts' as const, label: t('component.outstanding'), cell: balanceCell }]
						: [])
				]}
			/>
		{/key}
	{/if}
</AppShell>
