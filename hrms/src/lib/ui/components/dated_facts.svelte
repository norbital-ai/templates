<script lang="ts">
	/**
	 * Dated facts as a timeline of their changes, newest first. Each change is a row of the line: its day and what it
	 * changed; opened, it shows the facts as they stand from that day, each a plain field, several to a row. The day
	 * belongs to the change and is written once, on its row: only an edit shows it again, to move it. A value typed
	 * under a day is stored on that day's row as typed; an emptied value takes the fact away from that day. The
	 * enclosing view's one Save stores the list.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Accordion,
		Badge,
		Button,
		Combobox,
		Editor,
		FieldControl,
		Show,
		confirm_action,
		enum_text,
		format,
		label,
		use_form,
		type Kind,
		type Value
	} from '@norbital-ai/ui';
	import { Effect } from 'effect';
	import { Cluster, Column, Columns, Grid, Stack } from '@norbital-ai/ui/layout';
	import { onDestroy, type Snippet } from 'svelte';
	import type { Fact } from '../../dated_facts.js';
	import { jsonObject, type Json } from '../../payroll_engine/foundation.js';

	type Relation = { targets: readonly string[] };
	/** Something else dated on the same line of time (the day a stint began, its last day, a life event). */
	export type DatedEntry = {
		readonly key: string;
		readonly on: string;
		/** The row's parts, read as one line. */
		readonly line: readonly string[];
		/** The row opens in place, on what `entryBody` shows for it. */
		readonly expands?: boolean;
	};
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
		until,
		attributes = [],
		entries = [],
		firstLabel,
		fixedFirst = false,
		extra,
		entryBody,
		onchange
	}: {
		ctx: PageContext;
		id: string;
		/** The model whose fields the facts are: a choice reads its label from there. */
		of: string;
		facts: readonly Fact[];
		/** The list as stored: a fact it did not already take away is asked about before it is saved so. */
		base: readonly Fact[];
		/** The facts a change may name, in the order they are shown. */
		names: readonly { readonly value: string; readonly label: string }[];
		/** A fact's value editor: its kind, on the fact's own day. */
		kindOf: (fact: Fact) => { readonly kind: Kind; readonly relation?: Relation } | undefined;
		/** The value editor of a fact `kindOf` answers nothing for. */
		custom?: Snippet<[{ fact: Fact; id: string; readonly: boolean; set: (value: Value) => void }]>;
		/** The day a new change starts from; today when left out. */
		from?: string;
		/** The last day the facts hold (a stint's last day): past it, no change is in force. */
		until?: string | null | undefined;
		/** Names that say something of their own change only (the day it was signed): never carried to the next. */
		attributes?: readonly string[];
		entries?: readonly DatedEntry[];
		/** What the oldest change is called (a stint's is the day the person joined). Default: first recorded. */
		firstLabel?: string;
		/** The oldest change's day is not moved here: it is its owner's first day. */
		fixedFirst?: boolean;
		/** Shown first in an opened change, above its facts. */
		extra?: Snippet<[{ on: string; first: boolean; viewing: boolean }]>;
		/** What an entry that `expands` shows, opened; `viewing` while the facts are only read. */
		entryBody?: Snippet<[DatedEntry, boolean]>;
		onchange: (facts: readonly Fact[]) => void;
	} = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	// the enclosing form while it only shows the record: the facts are read, not edited
	const form = use_form();
	const viewing = $derived(form?.mode === 'view');
	const day = (value: string) => format({ kind: 'date' }, value, { locale: ctx.locale });
	const stored = (value: Value) => jsonObject({ value }).value ?? null;
	const labelOf = (name: string) => names.find((option) => option.value === name)?.label ?? name;
	// a value holding nothing (an empty record) says nothing while the facts are only read
	const says = (value: Json) =>
		value !== null &&
		!(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

	/** A change being added: its day, before anything is typed under it. */
	let drafted = $state<string | null>(null);
	/** The row opened (a change's day, or an entry's key): until the viewer picks, the change that stands today; `null` once they close every one. */
	let picked = $state<string | null | undefined>(undefined);
	/** The days something changed, newest first. */
	const days = $derived(
		[
			...new Set([
				...facts.flatMap((fact) => (fact.from === '' ? [] : [fact.from])),
				...(drafted === null ? [] : [drafted])
			])
		]
			.toSorted()
			.toReversed()
	);
	/** The change that stands today: the latest dated today or before, else the first one ahead. */
	const standing = $derived(days.find((on) => on <= clock.today) ?? days.at(-1) ?? null);
	/** The change in force today: none while every one is dated ahead, or once the facts no longer hold. */
	const current = $derived(
		standing !== null && standing <= clock.today && (until == null || until >= clock.today)
			? standing
			: null
	);
	const shown = $derived(
		picked === undefined
			? // facts that no longer hold (an ended stint) open only when asked
				until != null && until < clock.today
				? null
				: standing
			: picked !== null && days.includes(picked)
				? picked
				: null
	);
	/** The accordion's open row: the change shown, else an entry the viewer opened. */
	const opened = $derived(
		shown ?? (picked != null && entries.some((entry) => entry.key === picked) ? picked : '')
	);
	/** A fact whose value needs the row to itself: a structure, a list, or one with its own editor. */
	const wide = (name: string, value: Json, on: string) => {
		const kind = kindOf({ name, value, from: on })?.kind;
		if (kind === undefined || kind.many === true) return true;
		// a JSON field holding one plain value (a number, a date) is a plain field
		const held = kind.kind === 'json' ? kind.shape : kind;
		return (
			held === undefined ||
			held.many === true ||
			['object', 'record', 'union', 'json', 'custom', 'point'].includes(held.kind)
		);
	};
	/** What a name was before a day: its latest earlier value. */
	const before = (name: string, on: string) =>
		attributes.includes(name)
			? undefined
			: facts
					.filter((fact) => fact.name === name && fact.from !== '' && fact.from < on)
					.toSorted((a, b) => a.from.localeCompare(b.from))
					.at(-1);
	/** The facts as they stand from the day shown: what its own change says, over what stood before. */
	const lines = $derived.by(() => {
		const on = shown;
		if (on === null) return [];
		const listed = [
			...names.map((option) => option.value),
			...new Set(
				facts.flatMap((fact) =>
					fact.name === '' || names.some((option) => option.value === fact.name) ? [] : [fact.name]
				)
			)
		];
		return listed.flatMap((name) => {
			const own = facts.findLast((fact) => fact.name === name && fact.from === on);
			const held = before(name, on);
			const value = own === undefined ? (held?.value ?? null) : own.value;
			return viewing && !says(value) ? [] : [{ name, own, held, value }];
		});
	});
	const put = (name: string, value: Json) => {
		const on = shown;
		if (on === null) return;
		const held = before(name, on);
		const rest = facts.filter((fact) => !(fact.name === name && fact.from === on));
		// where nothing stood before, an emptied value is no fact, not one taken away
		onchange(
			value === null && (held === undefined || held.value === null)
				? rest
				: [...rest, { name, value, from: on }]
		);
	};
	const back = (name: string) =>
		onchange(facts.filter((fact) => !(fact.name === name && fact.from === shown)));
	const move = (next: string) => {
		const on = shown;
		if (on === null || next === '' || next === on) return;
		onchange(facts.map((fact) => (fact.from === on ? { ...fact, from: next } : fact)));
		if (drafted === on) drafted = next;
		picked = next;
	};
	const add = () => {
		drafted = from ?? clock.today;
		picked = drafted;
	};
	const drop = () => {
		const on = shown;
		onchange(facts.filter((fact) => fact.from !== on));
		if (drafted === on) drafted = null;
		picked = undefined;
	};
	const summary = (on: string) => {
		const changed = facts
			.filter((fact) => fact.from === on && !attributes.includes(fact.name))
			.map((fact) => labelOf(fact.name));
		return changed.length > 3
			? `${changed.slice(0, 3).join(', ')} +${changed.length - 3}`
			: changed.join(', ');
	};
	/** The line of time: the changes and whatever else is dated beside them, newest first. */
	const timeline = $derived(
		[
			...days.map((on, index) => ({
				key: `${id}-${on}`,
				on,
				change: true as const,
				line: [index === days.length - 1 ? (firstLabel ?? t('dated.first')) : summary(on)].filter(
					(part) => part !== ''
				)
			})),
			...entries.map((entry) => ({ ...entry, change: false as const }))
		].toSorted((a, b) => b.on.localeCompare(a.on))
	);
	const dot = (on: string) =>
		[
			'absolute top-2.5 -left-[5px] size-2.5 rounded-full border bg-background',
			on === current ? 'border-brand' : on > clock.today ? 'border-dashed' : 'border-border'
		].join(' ');
	// one fact has one value on one day: two changes moved onto one day are refused, not guessed between
	const twice = $derived(
		facts.filter(
			(fact, index) =>
				fact.name !== '' &&
				facts.some(
					(other, at) => at < index && other.name === fact.name && other.from === fact.from
				)
		)
	);
	// an emptied value takes the fact away from its day: asked once, where the stored list did not say so
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
	const dated = (fact: Fact) => t('dated.fact_on', { fact: labelOf(fact.name), date: fact.from });
	if (form !== undefined) {
		onDestroy(
			form.add_validation(() =>
				twice.map((fact) => ({
					field: `${id}.${fact.name}`,
					message: t('dated.twice', { fact: dated(fact) })
				}))
			)
		);
		onDestroy(
			form.confirm_submit(() =>
				taken.length === 0
					? Effect.succeed(true)
					: confirm_action({
							title: t('dated.take_away_title'),
							body: t('dated.take_away_body', { facts: taken.map(dated).join(', ') }),
							confirm_label: t('dated.take_away')
						})
			)
		);
	}
</script>

{#snippet field(line: (typeof lines)[number], on: string)}
	{@const fact = { name: line.name, value: line.value, from: on }}
	{@const shape = kindOf(fact)}
	{@const control = `${id}-${line.name}`}
	{@const set = (value: Value) => put(line.name, stored(value))}
	<FieldControl id={control} label={labelOf(line.name)} readonly={viewing}>
		<Grid tracks="minmax(0, 1fr) auto" gap="xs" align="start">
			{#if shape?.kind.kind === 'enum' && shape.kind.many !== true}
				<Combobox
					id={control}
					clearable={shape.kind.optional === true}
					readonly={viewing}
					value={typeof line.value === 'string' ? line.value : null}
					options={shape.kind.values.map((value) => ({
						value,
						label: label(ctx, of, `${line.name}.${value}`, enum_text(value))
					}))}
					on_change={set}
				/>
			{:else if shape !== undefined && viewing}
				<Show
					{ctx}
					readonly
					id={control}
					name={line.name}
					kind={shape.kind}
					value={line.value}
					{...shape.relation === undefined ? {} : { relation: shape.relation }}
				/>
			{:else if shape !== undefined}
				<Editor
					{ctx}
					id={control}
					name={line.name}
					kind={shape.kind}
					value={line.value}
					on_change={set}
					{...shape.relation === undefined ? {} : { relation: shape.relation }}
				/>
			{:else if custom !== undefined}
				{@render custom({ fact, id: control, readonly: viewing, set })}
			{:else}
				<span></span>
			{/if}
			{#if !viewing && line.own !== undefined && line.held !== undefined}
				<Button
					variant="ghost"
					size="icon"
					aria-label={t('dated.back', { fact: labelOf(line.name), date: day(line.held.from) })}
					title={t('dated.back', { fact: labelOf(line.name), date: day(line.held.from) })}
					onclick={() => back(line.name)}>↺</Button
				>
			{:else}
				<span></span>
			{/if}
		</Grid>
	</FieldControl>
{/snippet}

<Stack gap="sm">
	{#if !viewing}
		<Cluster gap="xs" justify="end">
			<Button variant="outline" onclick={add}>{t('dated.add_change')}</Button>
		</Cluster>
	{/if}
	{#if timeline.length === 0}
		<span class="text-meta">—</span>
	{:else}
		<Accordion.Root
			type="single"
			bind:value={() => opened, (next) => (picked = next === '' ? null : next)}
			class="ml-1.5 border-l border-border"
			aria-label={t('dated.changes')}
		>
			{#each timeline as entry (entry.key)}
				{#if entry.change}
					{@const first = entry.on === days.at(-1)}
					<Accordion.Item value={entry.on} class="relative border-b-0 pl-5">
						<span class={dot(entry.on)} aria-hidden="true"></span>
						<Accordion.Trigger class="py-1.5">
							<span class="flex min-w-0 flex-1 items-center gap-2">
								<span class="shrink-0 text-sm font-medium">{day(entry.on)}</span>
								<span class="text-meta min-w-0 flex-1 truncate font-normal"
									>{entry.line.join(' · ')}</span
								>
								{#if entry.on === current}<Badge variant="outline">{t('dated.current')}</Badge>{/if}
							</span>
						</Accordion.Trigger>
						<Accordion.Content>
							{#if entry.on === shown}
								<Stack gap="md" class="pt-1 pb-3">
									{#if !viewing}
										<!-- the change's day is on its row: only an edit shows it again, to move it -->
										<Cluster gap="md" align="end" justify="between">
											<Cluster gap="md" align="end">
												{#if !(fixedFirst && first)}
													<FieldControl id="{id}-from" label={t('dated.from')}>
														<Editor
															{ctx}
															id="{id}-from"
															name="from"
															kind={{ kind: 'date' }}
															value={entry.on}
															on_change={(next) =>
																move(next == null ? '' : String(next).slice(0, 10))}
														/>
													</FieldControl>
												{/if}
												{#each lines.filter( (line) => attributes.includes(line.name) ) as line (line.name)}
													{@render field(line, entry.on)}
												{/each}
											</Cluster>
											{#if !(fixedFirst && first) && (days.length > 1 || drafted !== null)}
												<Button variant="ghost" onclick={drop}>{t('dated.remove_change')}</Button>
											{/if}
										</Cluster>
									{/if}
									{@render extra?.({ on: entry.on, first, viewing })}
									<Columns count={3} collapse="compact">
										{#each lines.filter((line) => viewing || !attributes.includes(line.name)) as line (line.name)}
											{#if wide(line.name, line.value, entry.on)}
												<Column span="all">{@render field(line, entry.on)}</Column>
											{:else}
												{@render field(line, entry.on)}
											{/if}
										{/each}
									</Columns>
								</Stack>
							{/if}
						</Accordion.Content>
					</Accordion.Item>
				{:else if entry.expands && entryBody !== undefined}
					<Accordion.Item value={entry.key} class="relative border-b-0 pl-5">
						<span
							class="absolute top-3 -left-[3px] size-1.5 rounded-full bg-border"
							aria-hidden="true"
						></span>
						<Accordion.Trigger class="py-1.5">
							<span class="flex min-w-0 flex-1 items-center gap-2">
								<span class="shrink-0 text-sm font-medium">{day(entry.on)}</span>
								<span class="text-meta min-w-0 flex-1 truncate font-normal"
									>{entry.line.join(' · ')}</span
								>
							</span>
						</Accordion.Trigger>
						<Accordion.Content>
							{#if entry.key === opened}
								<div class="pt-1 pb-3">{@render entryBody(entry, viewing)}</div>
							{/if}
						</Accordion.Content>
					</Accordion.Item>
				{:else}
					<div class="relative py-1.5 pl-5">
						<span
							class="absolute top-3 -left-[3px] size-1.5 rounded-full bg-border"
							aria-hidden="true"
						></span>
						<span class="text-meta block truncate"
							><span class="font-medium text-foreground">{day(entry.on)}</span> · {entry.line.join(
								' · '
							)}</span
						>
					</div>
				{/if}
			{/each}
		</Accordion.Root>
	{/if}
	{#each twice as fact (`${fact.name}/${fact.from}`)}
		<p class="text-sm text-destructive" role="alert">{t('dated.twice', { fact: dated(fact) })}</p>
	{/each}
</Stack>
