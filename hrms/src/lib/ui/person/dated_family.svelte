<script lang="ts">
	/**
	 * One dated family of a person, stint by stint, newest first: each stint's changes over time and its facts as they
	 * stand from the change picked. It sits inside the view's form, whose one Save stores what the family answers.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Section, format, type Value } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { Snippet } from 'svelte';
	import type { Fact } from '../../dated_facts.js';
	import DatedFacts, { type DatedEntry } from '../components/dated_facts.svelte';
	import AllowanceTermsEditor from './allowance_terms_editor.svelte';
	import type { DatedFamily } from './dated_family.svelte.js';
	import type { PersonRead, StintRow } from './person_read.svelte.js';

	let {
		ctx,
		family,
		read,
		sections = true,
		stintActions,
		entriesOf
	}: {
		ctx: PageContext;
		family: DatedFamily;
		read: PersonRead;
		/** Each stint under its own heading; without, the facts sit in the enclosing section. */
		sections?: boolean;
		/** Beside a stint's heading. */
		stintActions?: Snippet<[StintRow]>;
		/** What else is dated on a stint's line of time. */
		entriesOf?: (stint: StintRow) => readonly DatedEntry[];
	} = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const heading = (stint: StintRow) =>
		`${read.company(stint.entity_id)?.name ?? ''} · ${format({ kind: 'period', of: 'date' }, stint.effective_range, { locale: ctx.locale })}`;
</script>

{#snippet facts(stint: StintRow)}
	{#snippet allowances({
		fact,
		id,
		readonly,
		set
	}: {
		fact: Fact;
		id: string;
		readonly: boolean;
		set: (value: Value) => void;
	})}<AllowanceTermsEditor
			field={{ id, value: fact.value, disabled: readonly, on_change: set }}
			law={family.lawOn(stint, fact.from)}
		/>{/snippet}
	<DatedFacts
		{ctx}
		id="{family.of}-{stint.id}"
		of={family.of}
		facts={family.facts(stint)}
		base={family.base(stint)}
		names={family.names(stint)}
		kindOf={family.kindOf(stint)}
		custom={allowances}
		from={family.nextMonth}
		until={stint.effective_range.to}
		attributes={family.attributes}
		entries={entriesOf?.(stint) ?? []}
		onchange={(next) => family.change(stint, next)}
	/>
{/snippet}

<Stack gap="md">
	{#if read.loading}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if read.stints.length === 0}
		{#if sections}
			<EmptyState title={t('person.not_employed_today')} />
		{:else}
			<p class="text-meta">{t('person.not_employed_today')}</p>
		{/if}
	{/if}
	{#each read.stints as stint, index (stint.id)}
		{#if sections}
			{#snippet buttons()}{@render stintActions?.(stint)}{/snippet}
			<Section
				name="{family.of}_{stint.id}"
				title={heading(stint)}
				hint={t('dated.hint')}
				first={index === 0}
				collapsible={false}
				{...stintActions === undefined ? {} : { actions: buttons }}
			>
				{@render facts(stint)}
			</Section>
		{:else}
			<Stack gap="sm">
				{#if read.stints.length > 1}<p class="text-meta">{heading(stint)}</p>{/if}
				{@render facts(stint)}
			</Stack>
		{/if}
	{/each}
</Stack>
