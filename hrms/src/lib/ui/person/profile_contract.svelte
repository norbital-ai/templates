<script lang="ts">
	/**
	 * The Contract tab: the person's employment over time. Each stint is its own line of time, newest first: the day it
	 * began, each change of its terms, its life events and its last day; the terms show as they stand from the change
	 * picked. What begins a stint (a hire, a rehire, a transfer) and what ends one start here; a stint's own record
	 * (its number, its days, its exit answers and events) opens from its line.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Form, enum_text, label, open_record } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { DatedEntry } from '../components/dated_facts.svelte';
	import DatedFamily from './dated_family.svelte';
	import { datedFamily } from './dated_family.svelte.js';
	import type { PersonRead, StintRow } from './person_read.svelte.js';
	import StintEnd from './stint_end.svelte';
	import StintStart from './stint_start.svelte';

	let {
		ctx,
		person,
		read
	}: { ctx: PageContext; person: Id<'employee_profile'>; read: PersonRead } = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	const family = datedFamily(ctx, 'contract_terms', read);
	let starting = $state<{ from: StintRow | null } | null>(null);
	let ending = $state<StintRow | null>(null);
	const open = (stint: StintRow) => (stint.effective_range.to ?? clock.today) >= clock.today;
	/** Someone with a stint that has not ended is hired already. */
	const employed = $derived(read.stints.some(open));
	const entriesOf = (stint: StintRow): readonly DatedEntry[] => {
		const { from, to } = stint.effective_range;
		const record = () => open_record('employment', stint.id);
		return [
			...(to == null
				? []
				: [
						{
							key: `${stint.id}-left`,
							on: to,
							line: [
								t('contract.last_working_day'),
								...(stint.exit_ground == null
									? []
									: [
											label(
												ctx,
												'employment',
												`exit_ground.${stint.exit_ground}`,
												enum_text(stint.exit_ground)
											)
										])
							],
							onpick: record
						}
					]),
			...(stint.events ?? []).map((event, index) => ({
				key: `${stint.id}-event-${index}`,
				on: event.on,
				line: [enum_text(event.kind)],
				onpick: record
			})),
			{
				key: `${stint.id}-joined`,
				on: from,
				line: [t('person.joined'), stint.employee_number],
				onpick: record
			}
		];
	};
</script>

{#snippet stintActions(stint: StintRow)}
	{#if stint.effective_range.to == null}
		<Button variant="outline" onclick={() => (starting = { from: stint })}
			>{t('contract.transfer')}</Button
		>
		<Button variant="outline" onclick={() => (ending = stint)}>{t('contract.terminate')}</Button>
	{/if}
{/snippet}

<Form
	{ctx}
	of="employee_profile"
	id={person}
	fields={[]}
	acts={family.acts}
	confirm={family.confirm}
	on_outcome={(outcome) => {
		if (outcome.kind === 'committed') family.reset();
	}}
>
	{#snippet children()}
		<Stack gap="md">
			{#if !read.loading && !employed}
				<Cluster gap="sm" align="center" justify="between">
					<span class="text-meta">{t('person.not_employed_today')}</span>
					<Button variant="outline" onclick={() => (starting = { from: null })}
						>{read.stints.length > 0 ? t('person.rehire') : t('person.hire')}</Button
					>
				</Cluster>
			{/if}
			{#if read.loading || read.stints.length > 0}
				<DatedFamily {ctx} {family} {read} {stintActions} {entriesOf} />
			{/if}
		</Stack>
	{/snippet}
</Form>
{#if starting !== null}
	<StintStart {ctx} {person} {read} from={starting.from} onclose={() => (starting = null)} />
{/if}
{#if ending !== null}
	<StintEnd {ctx} stint={ending} {read} onclose={() => (ending = null)} />
{/if}
