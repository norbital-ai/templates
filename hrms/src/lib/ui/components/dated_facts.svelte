<script lang="ts">
	/**
	 * Dated facts as a list: a fact, its value and the day it stands from, one row each. A row is stored as typed; an
	 * empty value takes the fact away from its day. The enclosing view's one Save stores the list.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Combobox, Editor, use_form, type Kind, type Value } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import type { Snippet } from 'svelte';
	import type { Fact } from '../../dated_facts.js';
	import { jsonObject } from '../../payroll_engine/foundation.js';

	type Relation = { targets: readonly string[] };
	let {
		ctx,
		id,
		facts,
		names,
		kindOf,
		custom,
		onchange
	}: {
		ctx: PageContext;
		id: string;
		facts: readonly Fact[];
		/** The facts a row may name. */
		names: readonly { readonly value: string; readonly label: string }[];
		/** A fact's value editor: its kind, on the fact's own day. */
		kindOf: (fact: Fact) => { readonly kind: Kind; readonly relation?: Relation } | undefined;
		/** The value editor of a fact `kindOf` answers nothing for. */
		custom?: Snippet<[{ fact: Fact; id: string; set: (value: Value) => void }]>;
		onchange: (facts: readonly Fact[]) => void;
	} = $props();
	const clock = ctx.clock('day');
	// the enclosing form while it only shows the record: the list is read, not edited
	const form = use_form();
	const viewing = $derived(form?.mode === 'view');
	const put = (index: number, next: Partial<Fact>) =>
		onchange(facts.map((fact, at) => (at === index ? { ...fact, ...next } : fact)));
	const stored = (value: Value) => jsonObject({ value }).value ?? null;
	const labelOf = (name: string) => names.find((option) => option.value === name)?.label ?? name;
</script>

<Stack gap="sm">
	<Grid tracks="minmax(10rem, 1fr) minmax(12rem, 2fr) 11rem auto" gap="sm" align="start">
		<span class="text-meta">{ctx.t('dated.fact')}</span>
		<span class="text-meta">{ctx.t('dated.value')}</span>
		<span class="text-meta">{ctx.t('dated.from')}</span>
		<span></span>
		{#each facts as fact, index (index)}
			{@const shape = fact.name === '' ? undefined : kindOf(fact)}
			{@const set = (value: Value) => put(index, { value: stored(value) })}
			{#if viewing}<span>{labelOf(fact.name)}</span>{:else}<Combobox
					id="{id}-{index}-name"
					value={fact.name === '' ? null : fact.name}
					options={[...names]}
					display={labelOf(fact.name)}
					placeholder={ctx.t('dated.fact')}
					searchable
					on_change={(next) => next !== null && put(index, { name: next, value: null })}
				/>{/if}
			{#if shape !== undefined}
				<Editor
					{ctx}
					id="{id}-{index}-value"
					name={fact.name}
					kind={shape.kind}
					value={fact.value}
					on_change={set}
					{...shape.relation === undefined ? {} : { relation: shape.relation }}
				/>
			{:else if fact.name !== '' && custom !== undefined}
				{@render custom({ fact, id: `${id}-${index}-value`, set })}
			{:else}
				<span></span>
			{/if}
			<Editor
				{ctx}
				id="{id}-{index}-from"
				name="from"
				kind={{ kind: 'date' }}
				value={fact.from}
				on_change={(next) => put(index, { from: next == null ? '' : String(next).slice(0, 10) })}
			/>
			{#if viewing}<span></span>{:else}<Button
					variant="ghost"
					size="icon"
					aria-label={ctx.t('dated.remove', { fact: labelOf(fact.name) })}
					onclick={() => onchange(facts.filter((_, at) => at !== index))}>×</Button
				>{/if}
		{/each}
	</Grid>
	{#if !viewing}
		<div>
			<Button
				variant="outline"
				onclick={() => onchange([...facts, { name: '', value: null, from: clock.today }])}
				>{ctx.t('dated.add_fact')}</Button
			>
		</div>
	{/if}
</Stack>
