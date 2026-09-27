<script lang="ts" module>
	type Catalogue =
		| 'claim_catalogue'
		| 'adhoc_catalogue'
		| 'allowance_catalogue'
		| 'loan_catalogue'
		| 'leave_catalogue';
</script>

<script lang="ts" generics="C extends Catalogue">
	/**
	 * The type picker's predicate for one person: the page's in-force clause, narrowed to the
	 * catalogue rows whose `eligibility` holds for them today.
	 *
	 * One read takes the employment with its employee, terms and entity (`ELIGIBILITY_SELECT`); one
	 * reads the candidate rows' ids and rules. The result is handed to the child as a `where`, which
	 * the form hands its catalogue `Picker`. With no employment chosen yet, or while the offer is
	 * read, every in-force row is offered; the transform holds the same rule at the write.
	 */
	import type { Snippet } from 'svelte';
	import type { Id, Where } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { todayKey } from './calendar.js';
	import { inForceCatalogue } from './create-scope.js';
	import {
		ELIGIBILITY_SELECT,
		eligibleTypeIds,
		eligibleTypeWhere,
		personAsOf
	} from '../eligible-types.js';
	import { plain } from '../wire.js';

	let {
		catalogue,
		employmentId,
		settingsCode,
		children
	}: {
		catalogue: C;
		employmentId: Id<'employments'> | undefined;
		settingsCode: string | undefined;
		children: Snippet<[where: NoInfer<Where<C>> | undefined]>; // C comes from `catalogue` alone: inferring it through the snippet is too deep for a form over a union
	} = $props();

	// Every catalogue reaches its version through `settings_id`: the clause holds for each of them.
	const inForce = $derived(inForceCatalogue(settingsCode) as Where<C> | undefined);
	/** The in-force version's rows only: every version together is thousands of ids, over a read's `in` limit. */
	async function offer(employment: Id<'employments'>) {
		const person = await bolt.get('employments', employment, ELIGIBILITY_SELECT);
		if (person == null) return inForce;
		const facts = plain(person) as Parameters<typeof personAsOf>[0];
		// A sheet opened outside a scoped page narrows to the chosen employment's own lineage.
		const clause = inForceCatalogue(settingsCode ?? facts.company_id?.settings_code);
		const candidates = await bolt.read<Catalogue>(catalogue, {
			...(clause == null ? {} : { where: clause as Where<Catalogue> }),
			select: { eligibility: true },
			all: true
		});
		return eligibleTypeWhere(
			clause,
			eligibleTypeIds(candidates.rows, personAsOf(facts, todayKey()))
		) as Where<C> | undefined;
	}
	const where = $derived(employmentId == null ? null : offer(employmentId));
</script>

{#if where == null}
	{@render children(inForce)}
{:else}
	{#await where}
		{@render children(inForce)}
	{:then narrowed}
		{@render children(narrowed)}
	{:catch}
		{@render children(inForce)}
	{/await}
{/if}
