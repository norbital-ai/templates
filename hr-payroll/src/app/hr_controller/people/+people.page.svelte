<script lang="ts">
	/**
	 * Workforce health for one legal entity (headcount in force today and twelve months of turnover and hire rate,
	 * derived from its employments' ranges, never stored) and one profile per person employed there.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { AppShell, Columns, Split, Stack } from '@norbital-ai/ui/layout';
	import { Chart, EmptyState, Table, Tabs } from '@norbital-ai/ui';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import Loading from '../../../lib/ui/Loading.svelte';
	import { companyScope } from '../../../lib/ui/company-scope.svelte.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';

	const scope = companyScope();
	const today = todayKey();
	const employments = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('employments', {
					where: { approval_id: { isNull: true }, company_id: { eq: scope.id } },
					select: { employee_id: true, effective_range: true },
					all: true
				})
	);
	// an open contract runs to the end of time
	const ranges = $derived(
		(employments.current ?? []).map((row) => ({
			employee: row.employee_id,
			start: row.effective_range.from,
			end: row.effective_range.to ?? '9999-12-31'
		}))
	);
	const current = $derived(
		new Set(ranges.filter((r) => r.start <= today && r.end >= today).map((r) => r.employee)).size
	);
	const TURNOVER = $derived(t('app.people.chart_turnover_rate'));
	const HIRES = $derived(t('app.people.chart_hire_rate'));
	// a rate in percent, one decimal: the chart's axis reads 4.2, not 0.042
	const rate = (count: number, average: number) =>
		average > 0 ? Math.round((count / average) * 1000) / 10 : 0;
	/** The last twelve payroll months: leavers and hires over the month's average headcount. */
	const trend = $derived.by(() => {
		const [year, month] = today.split('-').map(Number) as [number, number];
		return Array.from({ length: 12 }, (_, offset) => {
			const first = new Date(Date.UTC(year, month - 12 + offset, 1));
			const key = first.toISOString().slice(0, 7);
			const start = `${key}-01`;
			const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
				.toISOString()
				.slice(0, 10);
			const opening = ranges.filter((r) => r.start < start && r.end >= start).length;
			const closing = ranges.filter((r) => r.start <= end && r.end >= end).length;
			const average = (opening + closing) / 2;
			const leavers = ranges.filter((r) => r.end >= start && r.end <= end).length;
			const hires = ranges.filter((r) => r.start >= start && r.start <= end).length;
			return {
				month: key,
				[TURNOVER]: rate(leavers, average),
				[HIRES]: rate(hires, average)
			};
		});
	});
	const turnover = $derived(
		trend.reduce((sum, m) => sum + decodeNumber(m[TURNOVER]), 0) / trend.length
	);
	const percent = (n: number) =>
		(n / 100).toLocaleString(bolt.locale, { style: 'percent', maximumFractionDigits: 1 });
</script>

{#snippet empty(message: string)}
	{#if scope.unknown}<Loading />{:else}<EmptyState title={message} />{/if}
{/snippet}

{#snippet summary()}
	<Stack as="section" gap="md" aria-label={t('app.people.workforce')}>
		<div>
			<h2 class="text-heading">{t('app.people.workforce')}</h2>
			<p class="text-sm text-muted-foreground">{t('app.people.workforce_description')}</p>
		</div>
		{#if scope.id == null}
			{@render empty(t('app.people.empty_overview'))}
		{:else}
			<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
			<Columns count={2} gap="none" class="gap-px rounded-lg border bg-border">
				<Stack gap="none" class="bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{t('app.people.current')}</p>
					<p class="text-2xl font-semibold tabular-nums" data-headcount>{current}</p>
				</Stack>
				<Stack gap="none" class="bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{t('app.people.turnover_12m')}</p>
					<p class="text-2xl font-semibold tabular-nums">{percent(turnover)}</p>
				</Stack>
			</Columns>
		{/if}
	</Stack>
{/snippet}

{#snippet chart()}
	{#if scope.id == null}
		{@render empty(t('app.people.empty_trend'))}
	{:else}
		<div class="min-w-0 rounded-lg border bg-card p-4 shadow-card">
			<Chart
				of={trend}
				x="month"
				y={[TURNOVER, HIRES]}
				kind="line"
				title={t('app.people.chart_title')}
			/>
			<p class="text-sm text-muted-foreground">{t('app.people.chart_description')}</p>
		</div>
	{/if}
{/snippet}

{#snippet overview()}
	<Split ratio="third" collapse="stack" collapseAt="narrow" gap="lg" start={summary} end={chart} />
{/snippet}

{#snippet profiles()}
	{#if scope.id == null}
		{@render empty(t('app.people.empty_profiles'))}
	{:else}
		{#key scope.id}
			<Table
				of="employees"
				key={`people-${scope.id}`}
				toolbar={{ title: t('app.people.profiles_title') }}
				where={{
					employments: { some: { approval_id: { isNull: true }, company_id: { eq: scope.id } } }
				}}
				initialFilter={{ employments: { some: { effective_range: { contains: { today: '' } } } } }}
				orderBy={{ name: 'asc' }}
				columns={[
					'name',
					'email',
					'phone',
					'nationality',
					{ field: 'date_of_birth', label: t('app.people.date_of_birth') },
					{ field: 'dependents_count', label: t('app.people.dependents') },
					'face_enrollment_status'
				]}
			/>
		{/key}
	{/if}
{/snippet}

<AppShell
	icon="lucide:users"
	title={t('app.people.title')}
	description={t('app.people.description')}
	variant="full"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	<Tabs
		tabs={[
			{
				name: 'overview',
				title: t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				body: overview
			},
			{
				name: 'profiles',
				title: t('app.people.tab_profiles'),
				icon: 'lucide:users',
				body: profiles
			}
		]}
	/>
</AppShell>
