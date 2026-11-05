<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, Tabs, TimeInput } from '@norbital-ai/ui';
	import { monthOf } from '@norbital-ai/std/date';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import MonthBoard from '../../../lib/ui/roster/month_board.svelte';
	const scope = companyScope();
	const today = todayKey();
	let month = $state<string>(String(today).slice(0, 7));
	const from = $derived(`${month}-01`);
	const to = $derived(String(monthOf(from).to ?? from));
</script>

{#snippet board()}{#if scope.id !== null}<MonthBoard
			companyId={scope.id}
			{from}
			{to}
			today={String(today)}
		/>{/if}{/snippet}
{#snippet shifts()}{#if scope.id !== null}<Stack gap="lg"
			><Table
				of="shift_definition"
				key="shifts"
				where={{ entity_id: { eq: scope.id } }}
				toolbar={{ new: true, title: bolt.t('v2.shifts') }}
				columns={['code', 'variant', 'effective_range']}
			/><Table
				of="shift_pattern"
				key="patterns"
				where={{ entity_id: { eq: scope.id } }}
				toolbar={{ new: true, title: bolt.t('v2.patterns') }}
				columns={['code', 'pattern']}
			/></Stack
		>{/if}{/snippet}
<AppShell
	title={bolt.t('app.work.title')}
	description={bolt.t('v2.work_help')}
	icon="lucide:calendar-clock"
>
	{#snippet actions()}<TimeInput
			of="date"
			precision="month"
			value={`${month}-01`}
			onChange={(date: string | null) => {
				if (date != null) month = date.slice(0, 7);
			}}
		/><CompanyScope {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={bolt.t('app.events.empty_scope')} />{:else}<Tabs
			tabs={[
				{ name: 'board', title: bolt.t('v2.board'), body: board },
				{ name: 'shifts', title: bolt.t('v2.shifts'), body: shifts }
			]}
		/>{/if}
</AppShell>
