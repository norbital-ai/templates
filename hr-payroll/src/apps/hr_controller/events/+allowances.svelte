<script lang="ts">
	/**
	 * Standing allowances of one legal entity, and the entries payroll priced from them.
	 *
	 * Every allowance recurs: it is a catalogue item, a monthly amount and the window it is in
	 * force over. The first tab is those sources, ordered by the day they open. The second is what
	 * each pay period actually paid of them — one entry per period per allowance, created by the
	 * run under the payslip that priced it, carrying the days it covered, the divisor and the
	 * unpaid-leave days that came off, so a figure on a payslip explains itself.
	 *
	 * One live query per tab, and the same shape as its siblings in this group: the entity's own
	 * rows, each carrying its employment and its component. Rows held under an approval are listed
	 * and wear the pending badge rather than being filtered away — see `+claims.svelte` for why.
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
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../../lib/ui/create-scope.js';
	import { payRequestRecordMetadata } from '../../../lib/scheduling/lock.js';
	import MonthPeriodPicker from '../../../lib/ui/month-period-picker.svelte';
	import { createPayPeriodScope } from '../../../lib/ui/pay-period-scope.svelte.js';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	/** The pay period the entries are stepped by, in the entity's own grammar. */
	const pay = createPayPeriodScope(() => companyById(selectedCompanyId));
	let tab = $state('allowances');
	/** The scope the create form this page opens is drawn against. See `+claims.svelte`. */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined,
		allowanceFrom: () => pay.window?.start
	});

	type Named = {
		readonly allowance_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
		readonly allowance_allowance_catalogue?: Pick<
			WorkspaceRow<'allowance_catalogue'>,
			'code'
		> | null;
	};
	type AllowanceRow = WorkspaceRow<'allowances'> & Named;
	type EntryRow = WorkspaceRow<'allowance_entries'> & {
		readonly allowance_entry_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly allowance_entry_allowance_catalogue?: Pick<
			WorkspaceRow<'allowance_catalogue'>,
			'code'
		> | null;
	};
	const ownCompany = $derived({ some: { company_id: { eq: selectedCompanyId } } });
</script>

<AppShell
	icon="lucide:calendar-clock"
	title="Allowances"
	description="Standing allowances people are paid every period between two days, and what each payroll priced of them"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/requests-banner.webp"
>
	<AppHeaderActions>
		<CompanyScopeCombobox
			value={selectedCompanyId}
			onValueChange={(id) => {
				chosenCompanyId = id;
			}}
		/>
	</AppHeaderActions>

	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.events.empty_scope')}</p>
	{:else}
		{#key selectedCompanyId}
			<Tabs
				bind:value={tab}
				animate={false}
				contentPadding={false}
				config={[
					{
						name: 'allowances',
						label: t('app.events.tab_allowances'),
						icon: 'lucide:repeat',
						content: allowances
					},
					{
						name: 'entries',
						label: t('app.events.tab_allowance_entries'),
						icon: 'lucide:receipt-text',
						content: entries
					}
				] satisfies TabConfig[]}
			/>
		{/key}
	{/if}
</AppShell>

{#snippet allowances()}
	<CollectionTable
		{client}
		collection="allowances"
		view={`hr_controller:events:allowances:${selectedCompanyId}`}
		title={t('app.events.tab_allowances')}
		recordMetadata={(row: AllowanceRow) => payRequestRecordMetadata(row.approval_id, [], t)}
		query={{
			where: { allowance_employment: ownCompany },
			orderBy: { effective_from: 'desc' },
			with: {
				allowance_employment: { columns: { employee_number: true } },
				allowance_allowance_catalogue: { columns: { code: true } }
			}
		}}
	>
		{#snippet columns({ Column })}
			<Column
				name="catalogue_id"
				label={t('component.component')}
				card="title"
				renderer={FormattedValueRenderer}
				rendererProps={{
					format: ({ row }: { row: AllowanceRow }) => row.allowance_allowance_catalogue?.code ?? '—'
				}}
			/>
			<Column
				name="employment_id"
				label={t('component.person')}
				card="subtitle"
				renderer={FormattedValueRenderer}
				rendererProps={{
					format: ({ row }: { row: AllowanceRow }) =>
						row.allowance_employment?.employee_number ?? '—'
				}}
			/>
			<Column name="amount" label={t('component.amount')} />
			<Column name="effective_from" label={t('component.effective_from')} />
			<Column name="effective_to" label={t('component.effective_to')} />
			<!--
				Whether this one settles against its component's declared direction. It is the whole of
				what a correction is, so it is a column rather than a fact you open a row to find.
			-->
			<Column name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet entries()}
	{#if pay.bounds != null}
		{#key pay.period}
			<CollectionTable
				{client}
				collection="allowance_entries"
				view={`hr_controller:events:allowance-entries:${selectedCompanyId}:${pay.period}`}
				title={t('app.events.tab_allowance_entries')}
				navigation={periodNavigation}
				recordMetadata={(row: EntryRow) =>
					payRequestRecordMetadata(row.approval_id, [{ period: '' }], t)}
				query={{
					where: {
						allowance_entry_employment: ownCompany,
						from: { gte: pay.bounds.start, lt: pay.bounds.end }
					},
					orderBy: { from: 'desc' },
					with: {
						allowance_entry_employment: { columns: { employee_number: true } },
						allowance_entry_allowance_catalogue: { columns: { code: true } }
					}
				}}
			>
				{#snippet columns({ Column })}
					<Column
						name="catalogue_id"
						label={t('component.component')}
						card="title"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: EntryRow }) =>
								row.allowance_entry_allowance_catalogue?.code ?? '—'
						}}
					/>
					<Column
						name="employment_id"
						label={t('component.person')}
						card="subtitle"
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }: { row: EntryRow }) =>
								row.allowance_entry_employment?.employee_number ?? '—'
						}}
					/>
					<Column name="from" label={t('component.entry_from')} />
					<Column name="to" label={t('component.entry_to')} />
					<Column name="contract_amount" label={t('component.contract_amount')} />
					<Column name="days" label={t('component.entry_days')} />
					<Column name="denominator" label={t('component.entry_denominator')} />
					<Column name="unpaid_days" label={t('component.entry_unpaid_days')} />
					<Column name="amount" label={t('component.amount')} />
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

{#snippet periodNavigation()}
	<MonthPeriodPicker
		month={pay.period}
		halves={pay.halves}
		ariaLabel={t('app.events.pay_period')}
		onMonthChange={(next) => pay.select(next)}
	/>
{/snippet}
