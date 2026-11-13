<script lang="ts">
	/**
	 * The Contract tab: the person's stints as timelines of their terms, with what starts a stint (a hire, a rehire, a
	 * transfer) and what ends one. An ended stint's last day and exit answers are changed on the stint's own record.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, open_record } from '@norbital-ai/ui';
	import DatedFamily from './dated_family.svelte';
	import type { PersonRead, StintRow } from './person_read.svelte.js';
	import StintEnd from './stint_end.svelte';
	import StintStart from './stint_start.svelte';

	let {
		ctx,
		person,
		read
	}: { ctx: PageContext; person: Id<'employee_profile'>; read: PersonRead } = $props();
	let starting = $state<{ from: StintRow | null } | null>(null);
	let ending = $state<StintRow | null>(null);
</script>

{#snippet hire()}<Button variant="outline" onclick={() => (starting = { from: null })}
		>{read.stints.length > 0 ? ctx.t('person.rehire') : ctx.t('person.hire')}</Button
	>{/snippet}
{#snippet stintActions(stint: StintRow)}
	{#if stint.effective_range.to == null}
		<Button variant="outline" onclick={() => (starting = { from: stint })}
			>{ctx.t('contract.transfer')}</Button
		>
		<Button variant="outline" onclick={() => (ending = stint)}>{ctx.t('contract.terminate')}</Button
		>
	{/if}
	<Button variant="outline" onclick={() => open_record('employment', stint.id)}
		>{ctx.t('person.stint_details')}</Button
	>
{/snippet}

<DatedFamily {ctx} of="contract_terms" {read} actions={hire} {stintActions} />
{#if starting !== null}
	<StintStart {ctx} {person} {read} from={starting.from} onclose={() => (starting = null)} />
{/if}
{#if ending !== null}
	<StintEnd {ctx} stint={ending} {read} onclose={() => (ending = null)} />
{/if}
