<script lang="ts">
	/**
	 * Standing allowances of one legal entity: what each is paid under, how much, and whether it is
	 * paid once or across a window.
	 *
	 * The one family with no date column, so this table is ordered by when the row was written
	 * rather than by an event day. That is not an omission: a one-off's day is the first of the
	 * period it names and a recurring allowance's is the day its window opens, so a stored date
	 * would be a second statement of the same fact, free to disagree with the first.
	 *
	 * One live query, and the same shape as its three siblings in this group: the entity's own rows,
	 * each carrying its employment, its component and the payroll capture that may lock it. Rows
	 * held under an approval are listed and wear the pending badge rather than being filtered away
	 * — see `+claims.svelte` for why that clause is gone.
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
	/** The pay period the one-off entries are stepped by, in the entity's own grammar. */
	const pay = createPayPeriodScope(() => companyById(selectedCompanyId));
	/** The open tab: what a request created from this page is, before anyone touches the form. */
	let tab = $state('recurring');
	/** The scope the create form this page opens is drawn against. See `+claims.svelte`. */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined,
		allowanceRecurrence: () => {
			const start = pay.window?.start;
			if (start == null) return undefined;
			return tab === 'one-off'
				? { kind: 'ONE_OFF', on: start }
				: { kind: 'RECURRING', from: start, to: null };
		}
	});

	type AllowanceRow = WorkspaceRow<'allowance_requests'> & {
		readonly allowance_request_employment?: Pick<
			WorkspaceRow<'employments'>,
			'employee_number'
		> | null;
		readonly allowance_request_allowance_catalogue?: Pick<
			WorkspaceRow<'allowance_catalogue'>,
			'code'
		> | null;
	};
</script>

<AppShell
	icon="lucide:calendar-clock"
	title="Allowances"
	description="Standing allowances people are paid, each stating the one period or the window it is live across"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/pay_components-banner.webp"
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
						name: 'recurring',
						label: t('app.events.tab_recurring'),
						icon: 'lucide:repeat',
						content: recurringAllowances
					},
					{
						name: 'one-off',
						label: t('app.events.tab_one_off'),
						icon: 'lucide:calendar-check',
						content: oneOffAllowances
					}
				] satisfies TabConfig[]}
			/>
		{/key}
	{/if}
</AppShell>

{#snippet allowanceColumns({ Column }: { Column: any })}
	<Column
		name="catalogue_id"
		label={t('component.component')}
		card="title"
		renderer={FormattedValueRenderer}
		rendererProps={{
			format: ({ row }: { row: AllowanceRow }) =>
				row.allowance_request_allowance_catalogue?.code ?? '—'
		}}
	/>
	<Column
		name="employment_id"
		label={t('component.person')}
		card="subtitle"
		renderer={FormattedValueRenderer}
		rendererProps={{
			format: ({ row }: { row: AllowanceRow }) =>
				row.allowance_request_employment?.employee_number ?? '—'
		}}
	/>
	<Column name="amount" label={t('component.amount')} />
	<!--
						Whether this one settles against its component's declared direction. It is the whole
						of what a correction is now, so it is a column rather than a fact you open a row to
						find: the family that used to carry it had its own page.
					-->
	<Column name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
	<Column name="recurrence" label={t('component.entry_cadence')} />
{/snippet}

{#snippet recurringAllowances()}
	<CollectionTable
		{client}
		collection="allowance_requests"
		view={`hr_controller:events:allowances:recurring:${selectedCompanyId}`}
		title={t('app.events.tab_recurring')}
		recordMetadata={(row: AllowanceRow) =>
			payRequestRecordMetadata(row.approval_id, row.payslip_id == null ? [] : [{ period: '' }], t)}
		query={{
			where: {
				allowance_request_employment: { some: { company_id: { eq: selectedCompanyId } } },
				one_off_on: { isNull: true }
			},
			orderBy: { created_at: 'desc' },
			with: {
				allowance_request_employment: { columns: { employee_number: true } },
				allowance_request_allowance_catalogue: { columns: { code: true } }
			}
		}}
		columns={allowanceColumns}
	/>
{/snippet}

{#snippet oneOffAllowances()}
	{#if pay.bounds != null}
		{#key pay.period}
			<CollectionTable
				{client}
				collection="allowance_requests"
				view={`hr_controller:events:allowances:one-off:${selectedCompanyId}:${pay.period}`}
				title={t('app.events.tab_one_off')}
				navigation={periodNavigation}
				recordMetadata={(row: AllowanceRow) =>
					payRequestRecordMetadata(
						row.approval_id,
						row.payslip_id == null ? [] : [{ period: '' }],
						t
					)}
				query={{
					where: {
						allowance_request_employment: { some: { company_id: { eq: selectedCompanyId } } },
						one_off_on: { gte: pay.bounds.start, lt: pay.bounds.end }
					},
					orderBy: { one_off_on: 'desc' },
					with: {
						allowance_request_employment: { columns: { employee_number: true } },
						allowance_request_allowance_catalogue: { columns: { code: true } }
					}
				}}
				columns={allowanceColumns}
			/>
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
