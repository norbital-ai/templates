<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, TimeInput } from '@norbital-ai/ui';
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

{#snippet board()}{#if scope.company !== null}<MonthBoard
			company={scope.company}
			{from}
			{to}
			today={String(today)}
		/>{/if}{/snippet}
<AppShell
	title={bolt.t('app.work.title')}
	description={bolt.t('v2.work_help')}
	icon="lucide:calendar-clock"
>
	{#snippet actions()}<div class="w-44">
			<TimeInput
				of="date"
				precision="month"
				value={`${month}-01`}
				onChange={(date: string | null) => {
					if (date != null) month = date.slice(0, 7);
				}}
			/>
		</div>
		<CompanyScope {scope} />{/snippet}
	{#if scope.id === null}<EmptyState
			title={bolt.t('app.events.empty_scope')}
		/>{:else}{@render board()}{/if}
</AppShell>
