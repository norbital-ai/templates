<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Display, type ChartDisplaySpec } from '@norbital-ai/ui/chart';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { formatDataValue } from '@norbital-ai/ui/data-renderer';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesUnknown as companiesUnknownOf,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { Bound, Columns, Cover, Scroll, Split, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { employedTodayFilter, todayKey } from '../../lib/ui/calendar.js';
	import { inForceOnDay } from '../../lib/effective_range.js';

	const { t } = useI18n<TenantI18nKeys>();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesUnknown = $derived(companiesUnknownOf());
	const today = todayKey();

	const employmentsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.employments.findMany({
					where: {
						approval_id: { isNull: true },
						company_id: { eq: selectedCompanyId }
					},
					limit: 10_000
				})
	);

	/**
	 * People whose employment with this entity is in force today. Headcount is derived from
	 * effective employments — the schema stores no headcount column — and the same set is what the
	 * profile list opens on, so a leaver is not presented as current staff.
	 *
	 * The window is applied here rather than on `employmentsQuery` because the trend chart below
	 * needs twelve months of ranges, including ones that have since ended.
	 */
	const currentEmployeeIds = $derived(
		new Set(
			(employmentsQuery?.current ?? [])
				.filter((employment) => inForceOnDay(employment.effective_range, today))
				.map((employment) => employment.employee_id)
		)
	);
	const currentEmployees = $derived(currentEmployeeIds.size);
	const workforceTrend = $derived.by(() => {
		const ranges = (employmentsQuery?.current ?? []).flatMap((employment) =>
			employment.effective_range?.start
				? [
						{
							start: employment.effective_range.start.slice(0, 10),
							end: employment.effective_range.end?.slice(0, 10) ?? '9999-12-31'
						}
					]
				: []
		);
		// The window ends on the *payroll* month. Reading getUTCMonth() instead puts a viewer east of
		// Greenwich in last month for the first eight hours of every first-of-month.
		const [currentYear, currentMonth] = todayKey().split('-').map(Number) as [number, number];
		return Array.from({ length: 12 }, (_value, offset) => {
			const date = new Date(Date.UTC(currentYear, currentMonth - 1 - 11 + offset, 1));
			const month = date.toISOString().slice(0, 7);
			const monthStart = `${month}-01`;
			const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
				.toISOString()
				.slice(0, 10);
			const startingHeadcount = ranges.filter(
				(range) => range.start < monthStart && range.end >= monthStart
			).length;
			const endingHeadcount = ranges.filter(
				(range) => range.start <= monthEnd && range.end >= monthEnd
			).length;
			const leavers = ranges.filter(
				(range) => range.end >= monthStart && range.end <= monthEnd
			).length;
			const hires = ranges.filter(
				(range) => range.start >= monthStart && range.start <= monthEnd
			).length;
			const averageHeadcount = (startingHeadcount + endingHeadcount) / 2;
			return {
				month,
				turnover: averageHeadcount > 0 ? leavers / averageHeadcount : 0,
				hireRate: averageHeadcount > 0 ? hires / averageHeadcount : 0
			};
		});
	});
	const averageTurnover = $derived(
		workforceTrend.reduce((total, month) => total + month.turnover, 0) / workforceTrend.length
	);
	const workforceChart = $derived({
		kind: 'line',
		loading: employmentsQuery?.loading ?? false,
		title: t('app.people.chart_title'),
		description: t('app.people.chart_description'),
		data: workforceTrend,
		xKey: 'month',
		series: ['turnover', 'hireRate'],
		config: {
			turnover: { label: t('app.people.chart_turnover_rate'), color: 'var(--color-destructive)' },
			hireRate: { label: t('app.people.chart_hire_rate'), color: 'var(--color-primary)' }
		},
		valueFormat: { style: 'percent', maximumFractionDigits: 1 },
		curve: 'linear'
	} satisfies ChartDisplaySpec);
</script>

{#snippet companyScopeActions()}
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
{/snippet}

{#snippet workforceSummary()}
	<Stack as="section" gap="md" aria-labelledby="workforce-summary-heading">
		<div>
			<h2 id="workforce-summary-heading" class="text-heading">
				{t('app.people.workforce')}
			</h2>
			<p class="text-sm text-muted-foreground">
				{t('app.people.workforce_description')}
			</p>
		</div>
		{#if companiesUnknown}
			<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
		{:else if selectedCompanyId == null}
			<p class="text-sm text-muted-foreground">{t('app.people.empty_overview')}</p>
		{:else}
			<!-- repository-health:allow UI10 -- 1px hairline gutters via bg-border are not on the gap scale -->
			<Columns count={2} gap="none" class="gap-px rounded-lg border bg-border">
				<Stack gap="none" class="bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{t('app.people.current')}</p>
					<p class="text-2xl font-semibold tabular-nums">{currentEmployees}</p>
				</Stack>
				<Stack gap="none" class="bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{t('app.people.turnover_12m')}</p>
					<p class="text-2xl font-semibold tabular-nums">
						{averageTurnover.toLocaleString(undefined, {
							style: 'percent',
							maximumFractionDigits: 1
						})}
					</p>
				</Stack>
			</Columns>
		{/if}
	</Stack>
{/snippet}

{#snippet workforceTrendPanel()}
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.people.empty_trend')}</p>
	{:else}
		<div class="min-w-0 rounded-lg border bg-card p-4 shadow-card">
			<Display spec={workforceChart} class="min-h-[18rem]" />
		</div>
	{/if}
{/snippet}

{#snippet overview()}
	<Bound size="full">
		<Scroll name={t('component.tab_overview')}>
			<Split
				ratio="third"
				collapse="stack"
				collapseAt="narrow"
				gap="lg"
				start={workforceSummary}
				end={workforceTrendPanel}
			/>
		</Scroll>
	</Bound>
{/snippet}

{#snippet profiles()}
	{#if companiesUnknown}
		<p class="text-sm text-muted-foreground">{t('app.hr_controller.loading_scope')}</p>
	{:else if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.people.empty_profiles')}</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="employees"
				view={`hr_controller:people:profiles:${selectedCompanyId}`}
				title={t('app.people.profiles_title')}
				description={t('app.people.profiles_description')}
				initialFilters={employedTodayFilter()}
				query={{
					where: {
						employment_employee: {
							approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						}
					},
					orderBy: { name: 'asc' }
				}}
			>
				{#snippet columns({ Column })}
					<Column name="name" />
					<Column name="email" />
					<Column name="phone" />
					<Column name="nationality" />
					<Column name="date_of_birth" label={t('app.people.date_of_birth')} />
					<Column name="dependents_count" label={t('app.people.dependents')} />
					<Column name="face_enrollment_status" />
				{/snippet}
				{#snippet ListCard(person)}
					<Stack gap="xs">
						<p class="truncate font-medium">{person.name}</p>
						<p class="truncate text-sm text-muted-foreground">{person.email}</p>
						<p class="truncate text-sm">
							{person.phone
								? formatDataValue({ name: 'phone', kind: 'phone', nullable: true }, person.phone)
								: (person.nationality ?? '')}
						</p>
					</Stack>
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

<svelte:head>
	<title>People</title>
	<meta
		name="description"
		content="Workforce health, and one profile per person carrying their employments, contractual terms and statutory registrations"
	/>
	<meta name="bolt:icon" content="lucide:users" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/people-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/people-banner.webp"
	/>
</svelte:head>

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'overview',
				label: t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				content: overview
			},
			{
				name: 'profiles',
				label: t('app.people.tab_profiles'),
				icon: 'lucide:users',
				content: profiles
			}
		] satisfies TabConfig[]}
	/>
</Cover>
