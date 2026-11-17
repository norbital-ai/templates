<script lang="ts">
	/**
	 * Dated facts as a list: a fact, its value and the day it stands from, one row each. A row is stored as typed; an
	 * empty value takes the fact away from its day. The enclosing view's one Save stores the list.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Combobox,
		Editor,
		confirm_action,
		enum_text,
		label,
		use_form,
		type Kind,
		type Value
	} from '@norbital-ai/ui';
	import { Effect } from 'effect';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { onDestroy, type Snippet } from 'svelte';
	import type { Fact } from '../../dated_facts.js';
	import { jsonObject } from '../../payroll_engine/foundation.js';

	type Relation = { targets: readonly string[] };
	let {
		ctx,
		id,
		of,
		facts,
		base,
		names,
		kindOf,
		custom,
		from,
		onchange
	}: {
		ctx: PageContext;
		id: string;
		/** The model whose fields the facts are: a choice reads its label from there. */
		of: string;
		facts: readonly Fact[];
		/** The list as stored: a fact it did not already take away is asked about before it is saved so. */
		base: readonly Fact[];
		/** The facts a row may name. */
		names: readonly { readonly value: string; readonly label: string }[];
		/** A fact's value editor: its kind, on the fact's own day. */
		kindOf: (fact: Fact) => { readonly kind: Kind; readonly relation?: Relation } | undefined;
		/** The value editor of a fact `kindOf` answers nothing for. */
		custom?: Snippet<[{ fact: Fact; id: string; set: (value: Value) => void }]>;
		/** The day a new row starts from; today when left out. */
		from?: string;
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
	// what stands: each fact's latest row dated today or before, and every later one. The rows before those are its
	// history, shown on demand
	let history = $state(false);
	// a value holding nothing (an empty record) says nothing while the list is only read
	const says = (fact: Fact) =>
		!(
			typeof fact.value === 'object' &&
			fact.value !== null &&
			!Array.isArray(fact.value) &&
			Object.keys(fact.value).length === 0
		);
	const past = $derived(
		new Set(
			facts.flatMap((fact, index) => {
				if (fact.name === '' || fact.from === '' || fact.from > clock.today) return [];
				const superseded = facts.some(
					(other, at) =>
						at !== index &&
						other.name === fact.name &&
						other.from <= clock.today &&
						(other.from > fact.from || (other.from === fact.from && at > index))
				);
				return superseded ? [index] : [];
			})
		)
	);
	// one fact has one value on one day: a second row for it is refused, not guessed between
	const twice = $derived(
		facts.filter(
			(fact, index) =>
				fact.name !== '' &&
				facts.some(
					(other, at) => at < index && other.name === fact.name && other.from === fact.from
				)
		)
	);
	// a row left with no value takes the fact away from its day: asked once, where the stored list did not say so
	const taken = $derived(
		facts.filter(
			(fact) =>
				fact.name !== '' &&
				fact.value === null &&
				!base.some(
					(held) => held.name === fact.name && held.from === fact.from && held.value === null
				)
		)
	);
	const dated = (fact: Fact) =>
		ctx.t('dated.fact_on', { fact: labelOf(fact.name), date: fact.from });
	if (form !== undefined) {
		onDestroy(
			form.add_validation(() =>
				twice.map((fact) => ({
					field: `${id}.${fact.name}`,
					message: ctx.t('dated.twice', { fact: dated(fact) })
				}))
			)
		);
		onDestroy(
			form.confirm_submit(() =>
				taken.length === 0
					? Effect.succeed(true)
					: confirm_action({
							title: ctx.t('dated.take_away_title'),
							body: ctx.t('dated.take_away_body', { facts: taken.map(dated).join(', ') }),
							confirm_label: ctx.t('dated.take_away')
						})
			)
		);
	}
</script>

<Stack gap="sm">
	<Grid tracks="minmax(10rem, 1fr) minmax(12rem, 2fr) 11rem auto" gap="sm" align="start">
		<span class="text-meta">{ctx.t('dated.fact')}</span>
		<span class="text-meta">{ctx.t('dated.value')}</span>
		<span class="text-meta">{ctx.t('dated.from')}</span>
		<span></span>
		{#each facts as fact, index (index)}
			{#if history || !(past.has(index) || (viewing && !says(fact)))}
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
				{#if shape?.kind.kind === 'enum' && shape.kind.many !== true}
					<Combobox
						id="{id}-{index}-value"
						clearable={shape.kind.optional === true}
						readonly={viewing}
						value={typeof fact.value === 'string' ? fact.value : null}
						options={shape.kind.values.map((value) => ({
							value,
							label: label(ctx, of, `${fact.name}.${value}`, enum_text(value))
						}))}
						on_change={set}
					/>
				{:else if shape !== undefined}
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
			{/if}
		{/each}
	</Grid>
	{#each twice as fact (`${fact.name}/${fact.from}`)}
		<p class="text-sm text-destructive" role="alert">
			{ctx.t('dated.twice', { fact: dated(fact) })}
		</p>
	{/each}
	<Inline gap="sm">
		{#if !viewing}
			<Button
				variant="outline"
				onclick={() => onchange([...facts, { name: '', value: null, from: from ?? clock.today }])}
				>{ctx.t('dated.add_fact')}</Button
			>
		{/if}
		{#if past.size > 0}
			<Button variant="ghost" onclick={() => (history = !history)}
				>{history
					? ctx.t('dated.hide_history')
					: ctx.t('dated.show_history', { count: past.size })}</Button
			>
		{/if}
	</Inline>
</Stack>
