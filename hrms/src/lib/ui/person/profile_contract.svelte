<script lang="ts">
	/**
	 * The Contract tab: the person's employment over time. Each stint is its own line of time, newest first: the day the
	 * person joined with the first terms, each later change of them, life events and the last day. A stint's own answers
	 * sit on that line too: its number, credited service and life events under the day joined, its exit answers under the
	 * last day. What begins a stint (a hire, a rehire, a transfer) and what ends one start here. The one Save stores the
	 * terms and the stint's answers together.
	 */
	import type { Id, PlainDate } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Editor,
		FieldControl,
		Form,
		Label,
		Sheet,
		Show,
		enum_text,
		label,
		type FormProps,
		type Value
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Column, Columns, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import type { DatedEntry } from '../components/dated_facts.svelte';
	import { PAID_QUESTION, paidPeriods } from '../payroll/paid_period.svelte.js';
	import DatedFamily from './dated_family.svelte';
	import { datedFamily } from './dated_family.svelte.js';
	import DeleteButton from './delete_button.svelte';
	import type { PersonRead, StintRow } from './person_read.svelte.js';
	import { saved } from './save.js';
	import StintEnd from './stint_end.svelte';
	import StintStart from './stint_start.svelte';

	let {
		ctx,
		person,
		read
	}: { ctx: PageContext; person: Id<'employee_profile'>; read: PersonRead } = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	const paid = paidPeriods(ctx);
	const family = datedFamily(ctx, 'contract_terms', read);
	const kinds = $derived(ctx.ui.kinds.catalog?.employment?.fields ?? {});
	let starting = $state<{ from: StintRow | null } | null>(null);
	let ending = $state<StintRow | null>(null);
	const open = (stint: StintRow) => (stint.effective_range.to ?? clock.today) >= clock.today;
	/** Someone with a stint that has not ended is hired already. */
	const employed = $derived(read.stints.some(open));

	/** A stint's own answers, each shown as a field of its line of time. */
	type Answer =
		| 'employee_number'
		| 'service_started_on'
		| 'events'
		| 'exit_ground'
		| 'encash_leave'
		| 'final_pay_due_on'
		| 'reason';
	const HELP = {
		service_started_on: 'models.employment.help.service_started_on',
		events: 'models.employment.help.events',
		exit_ground: 'models.employment.help.exit_ground',
		encash_leave: 'models.employment.help.encash_leave',
		final_pay_due_on: 'models.employment.help.final_pay_due_on',
		reason: 'models.employment.help.reason'
	} as const;
	/** The answers as edited, by stint: the one Save stores them with the terms. */
	let answers = $state<Record<string, Record<string, Value>>>({});
	const answer = (stint: StintRow, name: Answer): Value =>
		answers[stint.id]?.[name] !== undefined
			? (answers[stint.id]?.[name] ?? null)
			: (stint[name] ?? null);
	const put = (stint: StintRow, name: Answer | 'effective_range', value: Value) =>
		(answers = { ...answers, [stint.id]: { ...answers[stint.id], [name]: value } });
	const lastDay = (stint: StintRow) => {
		const range = answers[stint.id]?.['effective_range'];
		return range !== undefined && range !== null && typeof range === 'object' && 'to' in range
			? range.to == null
				? null
				: String(range.to)
			: (stint.effective_range.to ?? null);
	};
	const eventDays = (value: Value | undefined) =>
		(Array.isArray(value) ? value : []).flatMap((event) =>
			event !== null && typeof event === 'object' && 'on' in event && typeof event.on === 'string'
				? [event.on]
				: []
		);
	const acts = () => {
		const rows = read.stints.flatMap((stint) => {
			const set = answers[stint.id];
			return set === undefined || Object.keys(set).length === 0
				? []
				: [{ target: { id: stint.id, revision: stint.revision }, set }];
		});
		return { ...family.acts(), ...(rows.length === 0 ? {} : { 'employment.update': rows }) };
	};
	/** A last day or a life event set, moved or cleared in a paid period amends it: HR is asked first. */
	const confirm: NonNullable<FormProps['confirm']> = () =>
		family.confirm() ??
		(read.stints.some((stint) => {
			const set = answers[stint.id];
			if (set === undefined) return false;
			const days = [
				...('effective_range' in set ? [stint.effective_range.to ?? null, lastDay(stint)] : []),
				...('events' in set ? [...eventDays(stint.events), ...eventDays(set['events'])] : [])
			];
			return days.some((day) => day !== null && paid.covers(day, stint.entity_id));
		})
			? PAID_QUESTION
			: null);

	let moving = $state<StintRow | null>(null);
	let firstDay = $state<PlainDate | null>(null);
	let saving = $state(false);
	/** The first day moves in one write: the stint carries its first terms and statutory parameters along. */
	function move() {
		const stint = moving;
		const day = firstDay;
		if (stint === null || day === null || saving) return;
		const range = { from: day, to: stint.effective_range.to ?? null };
		saving = true;
		fork(
			saved(
				ctx,
				paid.covers(stint.effective_range.from, stint.entity_id) ||
					paid.covers(day, stint.entity_id),
				() =>
					ctx.act({
						'employment.update': [
							{
								target: { id: stint.id, revision: stint.revision },
								set: { effective_range: range }
							}
						]
					})
			).pipe(
				Effect.tap((done) => Effect.sync(() => done && (moving = null))),
				Effect.ensuring(Effect.sync(() => (saving = false)))
			)
		);
	}

	const entriesOf = (stint: StintRow): readonly DatedEntry[] => [
		...(stint.effective_range.to == null
			? []
			: [
					{
						key: `${stint.id}-left`,
						on: stint.effective_range.to,
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
						expands: true
					}
				]),
		...(stint.events ?? []).map((event, index) => ({
			key: `${stint.id}-event-${index}`,
			on: event.on,
			line: [enum_text(event.kind)]
		}))
	];
</script>

{#snippet answerField(stint: StintRow, name: Answer, viewing: boolean)}
	{@const kind = kinds[name]}
	{@const id = `stint-${stint.id}-${name}`}
	{#if kind !== undefined}
		<FieldControl
			{id}
			label={label(ctx, 'employment', name)}
			{...name === 'employee_number' ? {} : { help: t(HELP[name]) }}
			readonly={viewing}
		>
			{#if viewing}
				<Show {ctx} readonly {id} {name} {kind} value={answer(stint, name)} />
			{:else}
				<Editor
					{ctx}
					{id}
					{name}
					{kind}
					value={answer(stint, name)}
					on_change={(next) => put(stint, name, next ?? null)}
				/>
			{/if}
		</FieldControl>
	{/if}
{/snippet}

{#snippet stintActions(stint: StintRow)}
	{#if stint.effective_range.to == null}
		<Button variant="outline" onclick={() => (starting = { from: stint })}
			>{t('contract.transfer')}</Button
		>
		<Button variant="outline" onclick={() => (ending = stint)}>{t('contract.terminate')}</Button>
	{/if}
{/snippet}

<!-- under the day the person joined: the stint's own answers, and what moves or deletes the stint -->
{#snippet joined(stint: StintRow, change: { on: string; first: boolean; viewing: boolean })}
	{#if change.first}
		<Stack gap="md">
			<Columns count={3} collapse="compact">
				{@render answerField(stint, 'employee_number', change.viewing)}
				{@render answerField(stint, 'service_started_on', change.viewing)}
				<Column span="all">{@render answerField(stint, 'events', change.viewing)}</Column>
			</Columns>
			{#if !change.viewing}
				<Cluster gap="xs" justify="end">
					<Button
						variant="outline"
						onclick={() => {
							firstDay = stint.effective_range.from;
							moving = stint;
						}}>{t('person.move_first_day')}</Button
					>
					<DeleteButton
						{ctx}
						label={t('person.delete_stint')}
						title={t('person.delete_stint_title')}
						body={t('person.delete_stint_body')}
						act={() =>
							ctx.act({
								'employment.delete': [{ target: { id: stint.id, revision: stint.revision } }]
							})}
					/>
				</Cluster>
			{/if}
		</Stack>
	{/if}
{/snippet}

<!-- under the last day: the exit answers; clearing the day cancels the exit -->
{#snippet left(stint: StintRow, _entry: DatedEntry, viewing: boolean)}
	<Columns count={3} collapse="compact">
		{#if !viewing}
			<FieldControl id="stint-{stint.id}-last-day" label={t('contract.last_working_day')}>
				<Editor
					{ctx}
					id="stint-{stint.id}-last-day"
					name="last_day"
					kind={{ kind: 'date', optional: true }}
					value={lastDay(stint)}
					on_change={(next) =>
						put(stint, 'effective_range', {
							from: stint.effective_range.from,
							to: next == null ? null : String(next)
						})}
				/>
			</FieldControl>
		{/if}
		{@render answerField(stint, 'exit_ground', viewing)}
		{@render answerField(stint, 'encash_leave', viewing)}
		{@render answerField(stint, 'final_pay_due_on', viewing)}
		<Column span="all">{@render answerField(stint, 'reason', viewing)}</Column>
	</Columns>
{/snippet}

<Form
	{ctx}
	of="employee_profile"
	id={person}
	fields={[]}
	{acts}
	{confirm}
	on_outcome={(outcome) => {
		if (outcome.kind !== 'committed') return;
		family.reset();
		answers = {};
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
				<DatedFamily
					{ctx}
					{family}
					{read}
					{stintActions}
					{entriesOf}
					firstLabel={t('person.joined')}
					fixedFirst
					extra={joined}
					entryBody={left}
				/>
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
<Sheet
	open={moving !== null}
	on_open_change={(next) => !next && !saving && (moving = null)}
	title={t('person.move_first_day')}
>
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('person.move_first_day_help')}</p>
		<Stack gap="xs">
			<Label for="stint-first-day">{t('person.first_day')}</Label>
			<Editor
				{ctx}
				id="stint-first-day"
				name="first_day"
				kind={{ kind: 'date' }}
				value={firstDay}
				disabled={saving}
				on_change={(next) => (firstDay = next == null ? null : String(next))}
			/>
		</Stack>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={() => (moving = null)}
				>{t('component.cancel')}</Button
			>
			<Button disabled={saving || firstDay === null} onclick={move}>{t('person.save')}</Button>
		</Cluster>
	</Stack>
</Sheet>
