<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { todayKey } from '../format/calendar.js';
	import { live } from '../state/live.svelte.js';
	import { t } from '../i18n/t.js';

	let { planId }: { planId: Id<'benefit_case_plans'> } = $props();
	const statusQuery = live(
		() => bolt.query('benefit_case_plans.advance_status', { plan_id: planId, as_of: todayKey() }),
		['benefit_case_plans', 'benefit_cases', 'benefit_case_movements']
	);
	type AdvanceStatus = {
		readonly status: string;
		readonly paid_by_due: number;
		readonly candidate_amount: number;
		readonly unproved_or_unlinked_recorded_cash: number;
	};
	const status = $derived(statusQuery.current as AdvanceStatus | undefined);
</script>

{#if statusQuery.error}
	<span class="text-sm text-destructive">{statusQuery.error}</span>
{:else if status == null}
	<span class="text-sm text-muted-foreground">{t('leave.advance_assessing')}</span>
{:else}
	<!-- one line: a table cell -->
	<span class="text-sm">
		{t('leave.advance_status_line', {
			status: status.status.replaceAll('_', ' ').toLowerCase(),
			paid: status.paid_by_due.toFixed(2),
			candidate: status.candidate_amount.toFixed(2)
		})}
		{#if status.unproved_or_unlinked_recorded_cash > 0}
			<span class="text-destructive">
				· {t('leave.advance_unproved', {
					amount: status.unproved_or_unlinked_recorded_cash.toFixed(2)
				})}
			</span>
		{/if}
	</span>
{/if}
