<script lang="ts">
	/**
	 * One legal entity's captured catalogue entries of one family (claims, ad hoc payments, leave) for one
	 * pay period: the entries whose own date falls inside the entity's window, and the payslip that captured each.
	 * An entry already pinned to a payslip is settled; the payroll automation, not this screen, moves it.
	 */
	import { t } from '../i18n/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Input, Table } from '@norbital-ai/ui';
	import { Debounced } from 'runed';
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

	/** The captured payment and leave families share an entry date and catalogue class. */
	type EntryCollection = 'adhoc_catalog_entry' | 'claim_catalog_entry' | 'leave_catalog_entry';

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
	// The entries carry no searchable text of their own: the box searches the person, by employee number or name.
	let typed = $state('');
	const query = new Debounced(() => typed.trim(), 250);
</script>

{#snippet personSearch()}
	<Input
		type="search"
		class="w-48"
		placeholder={t('component.search_person')}
		aria-label={t('component.search_person')}
		value={typed}
		oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
			(typed = event.currentTarget.value)}
	/>
{/snippet}

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet activityCell({ row, value }: { row: object; value: unknown })}{String(
		value ?? ''
	)}{#if 'days' in row && row.days != null}
		· {String(row.days)}{/if}{/snippet}
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
				occurred_on: { gte: pay.window.start, lte: pay.window.end },
				...(query.current === ''
					? {}
					: {
							or: [
								{ employment_id: { is: { $search: query.current } } },
								{ employment_id: { is: { employee_id: { is: { $search: query.current } } } } }
							]
						})
			} as const}
			<!-- repository-health:allow UI17 -- the tables' `key`, never shown -->
			{@const key = `${collection}-${scope.id}-${pay.period}`}
			<Table
				of={collection}
				{key}
				toolbar={{ title, search: false, controls: personSearch }}
				{where}
				orderBy={{ occurred_on: 'desc' }}
				columns={[
					{ field: 'catalog_id', label: t('component.component') },
					{ field: 'employment_id', label: t('component.person'), cell: personCell },
					// a movement names what it is (award, reversal, time off, encashment…) and a leave one the days it moves
					{ field: 'activity', label: t('component.activity'), cell: activityCell },
					{ field: 'amount', label: t('component.amount'), cell: amountCell },
					{ field: 'occurred_on', label: dateLabel },
					{ field: 'label', label: t('component.description') }
				]}
			/>
		{/key}
	{/if}
</AppShell>
