<script lang="ts">
	/**
	 * One legal entity's captured catalogue entries of one family (claims, ad hoc payments, leave) for one
	 * pay period: the entries whose own date falls inside the entity's window, and the payslip that captured each.
	 * An entry already pinned to a payslip is settled; the payroll automation, not this screen, moves it.
	 */
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, enumText, Input, Table, useBolt } from '@norbital-ai/ui';
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
	import { bolt } from '$bolt';
	import type { Row } from '@norbital-ai/bolt';
	import { Decimal } from '@norbital-ai/std/decimal';

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
	/** The column naming the entry's class: its catalogue's singular ("Leave type", "Claim type"). */
	const CLASS_LABEL = {
		adhoc_catalog_entry: 'models.adhoc_catalog.singular',
		claim_catalog_entry: 'models.claim_catalog.singular',
		leave_catalog_entry: 'models.leave_catalog.singular'
	} as const;
	const view = useBolt();
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
		placeholder={bolt.t('component.search_person')}
		aria-label={bolt.t('component.search_person')}
		value={typed}
		oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
			(typed = event.currentTarget.value)}
	/>
{/snippet}

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet activityCell({ row, value }: { row: object; value: unknown })}{enumText(
		String(value ?? ''),
		{ t: (key) => view.t(key), model: collection, field: 'activity' }
	)}{#if 'days' in row && row.days != null}
		· {String(row.days)}{/if}{/snippet}
{#snippet amountCell({
	value
}: {
	value: Row<'claim_catalog_entry'>['amount'] | undefined;
})}{#if value instanceof Decimal}
		{money(value.toNumber())}
	{:else}
		—
	{/if}{/snippet}

<AppShell {icon} {title} {description}>
	{#snippet actions()}
		<MonthPeriodPicker
			month={pay.period}
			halves={pay.halves}
			weeks={pay.weeks}
			ariaLabel={bolt.t('app.events.pay_period')}
			onMonthChange={(next) => pay.select(next)}
		/>
		<CompanyScope {scope} />
	{/snippet}
	{#if scope.unknown}
		<Skeleton class="h-40 w-full" />
	{:else if scope.id == null}
		<EmptyState title={bolt.t('app.events.empty_scope')} />
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
					{ field: 'catalog_id', label: bolt.t(CLASS_LABEL[collection]) },
					{ field: 'employment_id', label: bolt.t('component.person'), cell: personCell },
					// a movement names what it is (award, reversal, time off, encashment…) and a leave one the days it moves
					{ field: 'activity', label: bolt.t('component.activity'), cell: activityCell },
					{ field: 'amount', label: bolt.t('component.amount'), cell: amountCell },
					{ field: 'occurred_on', label: dateLabel },
					{ field: 'label', label: bolt.t('component.description') }
				]}
			/>
		{/key}
	{/if}
</AppShell>
