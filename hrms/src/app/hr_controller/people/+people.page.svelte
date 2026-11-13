<script lang="ts">
	/**
	 * Workforce health for one legal entity (headcount in force today and twelve months of turnover and hire rate,
	 * derived from its stints' first and last days, never stored) and one profile per person employed there.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Columns, Scroll, Split, Stack } from '@norbital-ai/ui/layout';
	import { DescriptionHint, Chart, EmptyState, Table, Tabs } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { fork } from '@norbital-ai/ui/effect';
	import { BigDecimal, DateTime, Effect } from 'effect';
	import { importDataRequest } from '../../../lib/ui/workbook/data_request_import.js';
	let { ctx }: { ctx: PageContext } = $props();

	const clock = ctx.clock('day');
	const scope = companyScope(ctx);
	const today = $derived(String(clock.today));
	const stints = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					employment: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employee_id', 'effective_range'],
						limit: 10000
					}
				})
	);
	// a hire is a stint's first day and a leaver its last; an open stint runs to the end of time
	const ranges = $derived(
		(stints?.current?.employment.rows ?? []).map((row) => ({
			employee: row.employee_id,
			start: String(row.effective_range.from),
			end: String(row.effective_range.to ?? '9999-12-31'),
			exit: row.effective_range.to != null
		}))
	);
	const current = $derived(
		new Set(ranges.filter((r) => r.start <= today && r.end >= today).map((r) => r.employee)).size
	);
	const TURNOVER = $derived(ctx.t('app.people.chart_turnover_rate'));
	const HIRES = $derived(ctx.t('app.people.chart_hire_rate'));
	// a rate in percent, one decimal: the chart's axis reads 4.2, not 0.042
	const rate = (count: number, average: number) =>
		average > 0
			? BigDecimal.toNumberUnsafe(
					BigDecimal.round(BigDecimal.fromNumberUnsafe((count / average) * 100), {
						scale: 1,
						mode: 'half-ceil'
					})
				)
			: 0;
	/** The last twelve payroll months: leavers and hires over the month's average headcount. */
	const trend = $derived.by(() => {
		const thisMonth = DateTime.startOf(DateTime.makeUnsafe(today), 'month');
		return Array.from({ length: 12 }, (_, offset) => {
			const first = DateTime.add(thisMonth, { months: offset - 11 });
			const start = DateTime.formatIsoDateUtc(first);
			const end = DateTime.formatIsoDateUtc(DateTime.endOf(first, 'month'));
			const key = start.slice(0, 7);
			const opening = ranges.filter((r) => r.start < start && r.end >= start).length;
			const closing = ranges.filter((r) => r.start <= end && r.end >= end).length;
			const average = (opening + closing) / 2;
			const leavers = ranges.filter((r) => r.exit && r.end >= start && r.end <= end).length;
			const hires = ranges.filter((r) => r.start >= start && r.start <= end).length;
			return {
				month: key,
				[TURNOVER]: rate(leavers, average),
				[HIRES]: rate(hires, average)
			};
		});
	});
	const turnover = $derived(trend.reduce((sum, m) => sum + Number(m[TURNOVER]), 0) / trend.length);
	let importing = $state(false);
	function importRequest() {
		importing = true;
		fork(importDataRequest(ctx).pipe(Effect.ensuring(Effect.sync(() => (importing = false)))));
	}
</script>

{#snippet empty(message: string)}
	<EmptyState title={message} />
{/snippet}

{#snippet summary()}
	<Stack as="section" gap="md" aria-label={ctx.t('app.people.workforce')}>
		<div>
			<div class="flex items-center gap-1">
				<h2 class="text-heading">{ctx.t('app.people.workforce')}</h2>
				<DescriptionHint text={ctx.t('app.people.workforce_description')} />
			</div>
		</div>
		{#if scope.id == null}
			{@render empty(ctx.t('app.people.empty_overview'))}
		{:else}
			<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
			<Columns count={2} gap="none" class="gap-px rounded-lg border bg-border">
				<Stack gap="none" class="bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{ctx.t('app.people.current')}</p>
					<p class="text-section tabular-nums" data-headcount>{current}</p>
				</Stack>
				<Stack gap="none" class="bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">
						{ctx.t('app.people.turnover_12m')}
					</p>
					<p class="text-section tabular-nums">
						{new Intl.NumberFormat(ctx.locale, {
							style: 'percent',
							maximumFractionDigits: 1
						}).format(turnover / 100)}
					</p>
				</Stack>
			</Columns>
		{/if}
	</Stack>
{/snippet}

{#snippet chart()}
	{#if scope.id == null}
		{@render empty(ctx.t('app.people.empty_trend'))}
	{:else}
		<div class="min-w-0 rounded-lg border bg-card p-4">
			<div class="mb-2 flex items-center gap-1">
				<h2 class="text-sm font-medium">{ctx.t('app.people.chart_title')}</h2>
				<DescriptionHint text={ctx.t('app.people.chart_description')} />
			</div>
			<Chart {ctx} of={trend} x="month" y={[TURNOVER, HIRES]} kind="line" />
		</div>
	{/if}
{/snippet}

{#snippet overview()}
	<Scroll name={ctx.t('component.tab_overview')} size="fill" inset>
		<Split
			ratio="third"
			collapse="stack"
			collapse_at="narrow"
			gap="lg"
			start={summary}
			end={chart}
		/>
	</Scroll>
{/snippet}

{#snippet profiles()}
	{#if scope.id == null}
		{@render empty(ctx.t('app.people.empty_profiles'))}
	{:else}
		{#key scope.id}
			<Table
				{ctx}
				of="employee_profile"
				key={`people-${scope.id}`}
				toolbar={{
					title: ctx.t('app.people.profiles_title'),
					new: false,
					actions: [
						{
							run: importRequest,
							icon: 'lucide:file-up',
							name: ctx.t('data_request.import'),
							description: ctx.t('data_request.import_description'),
							disabled: () => (importing ? ctx.t('component.loading') : null)
						}
					]
				}}
				where={{
					employment: {
						some: { entity_id: { eq: scope.id } }
					}
				}}
				initial_filter={{
					employment: { some: { effective_range: { contains: clock.today } } }
				}}
				order_by={{ name: 'asc' }}
				columns={['name', 'email', 'phone', 'face_enrollment_status']}
			/>
		{/key}
	{/if}
{/snippet}

<AppShell
	icon="lucide:users"
	title={ctx.t('app.people.title')}
	description={ctx.t('app.people.description')}
	variant="full"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	<Tabs
		tabs={[
			{
				name: 'profiles',
				title: ctx.t('app.people.tab_profiles'),
				icon: 'lucide:users',
				body: profiles
			},
			{
				name: 'overview',
				title: ctx.t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				body: overview
			}
		]}
	/>
</AppShell>
