<script lang="ts">
	/**
	 * One dated family of a person (the contract terms, or the statutory parameters): what is in force today, then each
	 * stint, newest first, as a timeline of its rows. A row shows its date and only what it changed, and opens its own
	 * record. The contract's timeline starts at the hire and ends at the last day, which opens the stint.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		EmptyState,
		Form,
		open_record,
		Section,
		Sheet,
		StructuredData,
		format
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { DateTime } from 'effect';
	import type { Snippet } from 'svelte';
	import { inForce } from '../../dated.js';
	import { PARAMETER_FIELDS, TERM_FIELDS, parametersChange, termsChange } from '../../person.js';
	import { jsonObject } from '../../payroll_engine/foundation.js';
	import VersionTimeline from '../components/version_timeline.svelte';
	import { paidPeriods } from '../payroll/paid_period.svelte.js';
	import { changeSummary, fieldLabel, named } from './change_summary.js';
	import DatedChangeFields from './dated_change_fields.svelte';
	import { covers, type PersonRead, type StintRow } from './person_read.svelte.js';

	let {
		ctx,
		of,
		read,
		actions,
		stintActions
	}: {
		ctx: PageContext;
		of: 'contract_terms' | 'statutory_parameters';
		read: PersonRead;
		/** Beside what is in force today. */
		actions?: Snippet;
		/** Beside a stint's "New change". */
		stintActions?: Snippet<[StintRow]>;
	} = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	const paid = paidPeriods(ctx);
	/** The timeline row of a stint's last day: it opens the stint. */
	const END = 'end';
	const fields = $derived(of === 'contract_terms' ? TERM_FIELDS : PARAMETER_FIELDS);
	const change = $derived(of === 'contract_terms' ? termsChange : parametersChange);
	const rowsOf = (stint: StintRow) =>
		(of === 'contract_terms' ? stint.terms : stint.parameters).map(jsonObject);
	const day = (value: unknown) => format({ kind: 'date' }, String(value), { locale: ctx.locale });
	const period = (stint: StintRow) =>
		format({ kind: 'period', of: 'date' }, stint.effective_range, { locale: ctx.locale });
	let adding = $state<Id<'employment'> | null>(null);
	const current = $derived(read.stints.find((stint) => covers(stint, clock.today)));
	const head = $derived(
		current === undefined
			? null
			: named(inForce(rowsOf(current).map(change), clock.today).state, read.names)
	);
	/** A change starts on the first of a month: the next one, until HR says otherwise. */
	const nextMonth = $derived(
		DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.startOf(DateTime.makeUnsafe(clock.today), 'month'), { months: 1 })
		)
	);
	const timeline = (stint: StintRow) => {
		const from = String(stint.effective_range.from);
		const to = stint.effective_range.to == null ? null : String(stint.effective_range.to);
		const status = (on: string) =>
			on > clock.today ? t('law_changes.upcoming') : t('app.settings.version_in_force');
		return [
			...(of === 'contract_terms' && to !== null
				? [
						{
							id: END,
							period: `${t('person.last_day')} · ${day(to)}`,
							status: to > clock.today ? t('law_changes.upcoming') : t('contract.ended'),
							detail: [
								...(stint.exit_ground == null ? [] : [fieldLabel(stint.exit_ground.toLowerCase())]),
								...(stint.reason == null || stint.reason === '' ? [] : [stint.reason]),
								...(stint.encash_leave === false ? [t('contract.leave_not_encashed')] : [])
							].join(' · ')
						}
					]
				: []),
			...rowsOf(stint)
				.toSorted((left, right) =>
					String(right.effective_from).localeCompare(String(left.effective_from))
				)
				.map((row) => {
					const on = String(row.effective_from);
					return {
						id: String(row.id),
						period:
							of === 'contract_terms' && on === from
								? `${t('person.hired')} · ${day(on)}`
								: day(on),
						status: status(on),
						detail: [
							changeSummary(row, fields, t('law_changes.removed'), read.names),
							...(typeof row.signed_on === 'string'
								? [t('person.signed_on', { date: day(row.signed_on) })]
								: [])
						]
							.filter((text) => text !== '')
							.join(' · ')
					};
				})
		];
	};
</script>

<Stack gap="md">
	<Section
		name="{of}_in_force"
		title={t('entity.in_force_today')}
		first
		collapsible={false}
		{...actions === undefined ? {} : { actions }}
	>
		{#if read.loading}
			<p class="text-meta">{t('component.loading')}</p>
		{:else if head === null}
			<EmptyState title={t('person.not_employed_today')} />
		{:else}
			<StructuredData {ctx} mode="view" value={head} />
		{/if}
	</Section>
	{#each read.stints as stint (stint.id)}
		{@const items = timeline(stint)}
		{#snippet buttons()}<Button variant="outline" onclick={() => (adding = stint.id)}
				>{t('entity.new_change')}</Button
			>{@render stintActions?.(stint)}{/snippet}
		<Section
			name="{of}_{stint.id}"
			title="{read.company(stint.entity_id)?.name ?? ''} · {period(stint)}"
			collapsible={false}
			actions={buttons}
		>
			{#if items.length === 0}
				<EmptyState title={t('entity.changes_empty')} />
			{:else}
				<VersionTimeline
					label={t('app.settings.changes')}
					{items}
					onOpen={(id) => (id === END ? open_record('employment', stint.id) : open_record(of, id))}
				/>
			{/if}
		</Section>
	{/each}
</Stack>

<Sheet
	open={adding !== null}
	on_open_change={(open) => !open && (adding = null)}
	title={t('entity.new_change')}
>
	{#if adding !== null}
		<Form
			{ctx}
			{of}
			mode="create"
			values={{ employment_id: adding, effective_from: nextMonth }}
			confirm={paid.confirm(() => false, ['effective_from'])}
			on_outcome={(outcome) => {
				if (outcome.kind === 'committed') adding = null;
			}}
		>
			{#snippet children()}<DatedChangeFields {ctx} {of} />{/snippet}
		</Form>
	{/if}
</Sheet>
