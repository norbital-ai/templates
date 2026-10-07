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
	import { companyScope, employmentNames } from '../scopes/company_scope.svelte.js';
	import MonthPeriodPicker from '../components/month_period_picker.svelte';
	import { createPayPeriodScope } from '../scopes/pay_period_scope.svelte.js';
	import { formatNumeric } from '../format/display_formatters.js';
	import { isJsonObject, moneyNumber } from '../../payroll_engine/foundation.js';

	/** The four captured-entry families, all one shape: reference, occurred_on, values, catalog_id. */
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
	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const person = employmentNames(() => scope.id);
	const amountOf = (values: unknown): number | null =>
		isJsonObject(values) ? moneyNumber(values['amount']) : null;
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet amountCell({ value }: { value: unknown })}{#if amountOf(value) == null}
		—
	{:else}
		{formatNumeric(amountOf(value))}
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
					{ field: 'reference', label: t('component.reference') }
				]}
			/>
		{/key}
	{/if}
</AppShell>
