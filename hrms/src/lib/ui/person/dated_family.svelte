<script lang="ts">
	/**
	 * One dated family of a person, stint by stint, newest first: each stint's changes over time and its facts as they
	 * stand from the change picked. A stint is named by its company and employee number; its days are on its line of
	 * time. It sits inside the view's form, whose one Save stores what the family answers.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Section, type Value } from '@norbital-ai/ui';
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
		entriesOf,
		firstLabel,
		fixedFirst = false,
		extra,
		entryBody
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
		/** What a stint's oldest change is called. */
		firstLabel?: string;
		/** A stint's oldest change keeps the stint's first day. */
		fixedFirst?: boolean;
		/** Shown first in an opened change of a stint. */
		extra?: Snippet<[StintRow, { on: string; first: boolean; viewing: boolean }]>;
		/** What an entry that expands shows, opened; `viewing` while the facts are only read. */
		entryBody?: Snippet<[StintRow, DatedEntry, boolean]>;
	} = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const heading = (stint: StintRow) =>
		`${read.company(stint.entity_id)?.name ?? ''} · ${stint.employee_number}`;
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
	{#snippet above(change: { on: string; first: boolean; viewing: boolean })}{@render extra?.(
			stint,
			change
		)}{/snippet}
	{#snippet opened(entry: DatedEntry, viewing: boolean)}{@render entryBody?.(
			stint,
			entry,
			viewing
		)}{/snippet}
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
		{fixedFirst}
		{...firstLabel === undefined ? {} : { firstLabel }}
		{...extra === undefined ? {} : { extra: above }}
		{...entryBody === undefined ? {} : { entryBody: opened }}
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
