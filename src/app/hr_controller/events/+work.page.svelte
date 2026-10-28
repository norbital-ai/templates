<script lang="ts">
	/**
	 * The roster board of one legal entity for one pay period: every person employed in the period against its days,
	 * the plan and the clock side by side. A cell opens the day's clock; the kiosk punches the day. The ⚡ menu carries
	 * the `roster_entry` work-day sheet (import and template), scoped to this entity and period.
	 */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { CustomView, EmptyState } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { employmentLabel, entityTimeZone } from '../../../lib/ui/scopes/create_scope.js';
	import MonthPeriodPicker from '../../../lib/ui/components/month_period_picker.svelte';
	import { createPayPeriodScope } from '../../../lib/ui/scopes/pay_period_scope.svelte.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import { governingVersion } from '../../../lib/ui/person/governing_version.svelte.js';
	import MonthBoard from '../../../lib/ui/roster/month_board.svelte';

	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const today = todayKey();
	const version = governingVersion(
		() => scope.id,
		() => String(pay.window?.start ?? today)
	);
	const timeZone = $derived(entityTimeZone(scope.company, version.current));
	const policy = $derived(version.current?.payroll?.attendance ?? null);

	const contracts = $derived.by(() =>
		scope.id == null
			? null
			: bolt.query({
					employment_contract: {
						where: { company_id: { eq: scope.id } },
						fields: ['employee_number', 'employee_id', 'effective_range'],
						orderBy: { employee_number: 'asc' }
					},
					'employment_contract.employee_id': { fields: ['name'] }
				})
	);
	/** The people employed at any time in the period. */
	const people = $derived(
		pay.window == null
			? []
			: (contracts?.current?.employment_contract.rows ?? [])
					.filter(
						(row) =>
							row.effective_range.from <= pay.window!.end &&
							(row.effective_range.to == null || row.effective_range.to >= pay.window!.start)
					)
					.map((row) => ({
						id: row.id,
						number: row.employee_number,
						name: employmentLabel(row),
						from: String(row.effective_range.from),
						to: row.effective_range.to == null ? null : String(row.effective_range.to)
					}))
	);
</script>

<AppShell
	icon="lucide:calendar-clock"
	title={bolt.t('app.work.title')}
	description={bolt.t('app.work.description')}
>
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
		<p class="text-meta">{bolt.t('component.loading')}</p>
	{:else if scope.id == null}
		<EmptyState title={bolt.t('app.scheduling.empty_board')} />
	{:else if pay.window != null}
		{@const companyId = scope.id}
		{@const window = pay.window}
		{#key `${companyId}:${window.start}:${window.end}`}
			<CustomView
				model="roster_entry"
				of={people}
				key="work"
				fields={[
					{ field: 'number', label: bolt.t('component.employee_number') },
					{ field: 'name', label: bolt.t('component.name') }
				]}
				toolbar={{
					title: bolt.t('app.scheduling.board_title'),
					new: false,
					context: { company_id: companyId, from: window.start, to: window.end }
				}}
			>
				{#snippet children(shown)}
					<MonthBoard
						people={shown}
						{companyId}
						from={window.start}
						to={window.end}
						{timeZone}
						{policy}
						{today}
					/>
				{/snippet}
			</CustomView>
		{/key}
	{/if}
</AppShell>
