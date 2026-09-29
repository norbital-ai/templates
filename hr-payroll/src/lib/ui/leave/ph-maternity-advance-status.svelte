<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { todayKey } from '../calendar.js';
	import { live } from '../live.svelte.js';

	let { planId }: { planId: Id<'ph_maternity_pay_plans'> } = $props();
	const statusQuery = live(
		() =>
			bolt.query('ph_maternity_pay_plans.advance_status', { plan_id: planId, as_of: todayKey() }),
		['ph_maternity_pay_plans', 'ph_maternity_cases', 'ph_maternity_movements']
	);
	type AdvanceStatus = {
		readonly status: string;
		readonly paid_by_due: number;
		readonly candidate_sss_amount: number;
		readonly unproved_or_unlinked_recorded_cash: number;
	};
	const status = $derived(statusQuery.current as AdvanceStatus | undefined);
</script>

{#if statusQuery.error}
	<span class="text-sm text-destructive">{statusQuery.error}</span>
{:else if status == null}
	<span class="text-sm text-muted-foreground">Assessing advance…</span>
{:else}
	<div class="text-sm">
		<p>{status.status.replaceAll('_', ' ')}</p>
		<p class="text-muted-foreground">
			Recorded with attachment by due date: ₱{status.paid_by_due.toFixed(2)} / candidate ₱{status.candidate_sss_amount.toFixed(
				2
			)}
		</p>
		{#if status.unproved_or_unlinked_recorded_cash > 0}
			<p class="text-destructive">
				₱{status.unproved_or_unlinked_recorded_cash.toFixed(2)} recorded without qualifying plan evidence
			</p>
		{/if}
	</div>
{/if}
