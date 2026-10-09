<script lang="ts">
	/**
	 * The roster board of one legal entity for one pay period: every person employed in the period against its days,
	 * the plan and the clock side by side. A cell opens the day's clock; the kiosk punches the day. The ⚡ menu carries
	 * the `roster_entry` work-day sheet (import and template), scoped to this entity and period.
	 */
	import { bolt } from '$bolt';
	import { t } from '../../../lib/ui/i18n/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { CustomView, EmptyState } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { employmentLabel, entityTimeZone } from '../../../lib/ui/scopes/create_scope.js';
	import MonthPeriodPicker from '../../../lib/ui/components/month_period_picker.svelte';
	import { createPayPeriodScope } from '../../../lib/ui/scopes/pay_period_scope.svelte.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import { governingVersion } from '../../../lib/ui/person/governing_version.svelte.js';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import MonthBoard from '../../../lib/ui/roster/month_board.svelte';

	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const today = todayKey();
	const version = governingVersion(
		() => scope.id,
		() => String(pay.window?.start ?? today)
	);
	const timeZone = $derived(entityTimeZone(scope.company, version.current));

	const contracts = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('employment_contract', {
					where: { company_id: { eq: scope.id }, approval_id: { isNull: true } },
					select: {
						employee_number: true,
						employee_id: { select: { name: true } },
						effective_range: true
					},
					orderBy: { employee_number: 'asc' },
					all: true
				})
	);
	/** The people employed at any time in the period. */
	const people = $derived(
		pay.window == null
			? []
			: (contracts.current ?? [])
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

{#snippet periodPicker()}
	<MonthPeriodPicker
		month={pay.period}
		halves={pay.halves}
		weeks={pay.weeks}
		ariaLabel={t('app.events.pay_period')}
		onMonthChange={(next) => pay.select(next)}
	/>
{/snippet}

{#snippet workTools()}
	{@render periodPicker()}
{/snippet}

<AppShell
	icon="lucide:calendar-clock"
	title={t('app.work.title')}
	description={t('app.work.description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.unknown}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if scope.id == null}
		<EmptyState title={t('app.scheduling.empty_board')} />
	{:else if pay.window != null}
		{@const companyId = scope.id}
		{@const window = pay.window}
		<CustomView
			collection="roster_entry"
			of={people}
			key="work"
			fields={[
				{ field: 'number', label: t('component.employee_number') },
				{ field: 'name', label: t('component.name') }
			]}
			toolbar={{
				title: t('app.scheduling.board_title'),
				controls: workTools,
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
					{today}
				/>
			{/snippet}
		</CustomView>
	{/if}
</AppShell>
