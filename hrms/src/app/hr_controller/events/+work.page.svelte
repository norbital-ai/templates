<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, TimeInput } from '@norbital-ai/ui';
	import { DateTime } from 'effect';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import MonthBoard from '../../../lib/ui/roster/month_board.svelte';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const today = ctx.clock().today;
	let month = $state<string>(String(today).slice(0, 7));
	const from = $derived(`${month}-01`);
	const to = $derived(
		DateTime.formatIsoDateUtc(DateTime.endOf(DateTime.makeUnsafe(from), 'month'))
	);
</script>

{#snippet board()}{#if scope.company !== null}<MonthBoard
			{ctx}
			company={scope.company}
			{from}
			{to}
			today={String(today)}
		/>{/if}{/snippet}
<AppShell
	title={ctx.t('app.work.title')}
	description={ctx.t('v2.work_help')}
	icon="lucide:calendar-clock"
>
	{#snippet actions()}<div class="w-44">
			<TimeInput
				{ctx}
				of="date"
				precision="month"
				value={`${month}-01`}
				on_change={(date: string | null) => {
					if (date != null) month = date.slice(0, 7);
				}}
			/>
		</div>
		<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState
			title={ctx.t('app.events.empty_scope')}
		/>{:else}{@render board()}{/if}
</AppShell>
