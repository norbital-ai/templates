<script lang="ts">
	/**
	 * One dated family of a person (the contract terms, or the statutory parameters): each stint, newest first, as its
	 * list of facts, a fact, its value and the day it stands from. The list is edited in place and the view's one Save
	 * stores it. A statutory parameter is one the law of the stint's company declares.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Form, Section, format, type Value } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { DateTime } from 'effect';
	import type { Snippet } from 'svelte';
	import { factWrites, factsOf, type Fact } from '../../dated_facts.js';
	import { TERM_FIELDS } from '../../person.js';
	import { jsonObject } from '../../payroll_engine/foundation.js';
	import DatedFacts from '../components/dated_facts.svelte';
	import { declaredParameters } from '../components/parameter_facts.js';
	import { pageLaws } from '../law.svelte.js';
	import { PAID_QUESTION, paidPeriods } from '../payroll/paid_period.svelte.js';
	import AllowanceTermsEditor from './allowance_terms_editor.svelte';
	import { fieldLabel } from './change_summary.js';
	import { categoryValues } from './contract_categories.js';
	import type { PersonRead, StintRow } from './person_read.svelte.js';

	let {
		ctx,
		of,
		person,
		read,
		actions,
		stintActions
	}: {
		ctx: PageContext;
		of: 'contract_terms' | 'statutory_parameters';
		person: Id<'employee_profile'>;
		read: PersonRead;
		/** Above the stints. */
		actions?: Snippet;
		/** Beside a stint's title. */
		stintActions?: Snippet<[StintRow]>;
	} = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const clock = ctx.clock('day');
	const paid = paidPeriods(ctx);
	const shape = $derived(
		of === 'contract_terms'
			? { fields: TERM_FIELDS, attributes: ['signed_on'] }
			: { fields: [], record: 'parameters' }
	);
	const rowsOf = (stint: StintRow) =>
		(of === 'contract_terms' ? stint.terms : stint.parameters).map(jsonObject);
	const period = (stint: StintRow) =>
		format({ kind: 'period', of: 'date' }, stint.effective_range, { locale: ctx.locale });
	const codeOf = (stint: StintRow) => read.company(stint.entity_id)?.settings_code;
	const laws = pageLaws(ctx, () => [
		...new Set(read.stints.flatMap((stint) => codeOf(stint) ?? []))
	]);
	const lawOn = (stint: StintRow, day: string) =>
		laws.on(codeOf(stint), day === '' ? clock.today : day);
	const exposure = $derived(ctx.ui.kinds.catalog?.[of]);
	/** A change to a person starts on the first of a month: the next one, until HR says otherwise. */
	const nextMonth = $derived(
		DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.startOf(DateTime.makeUnsafe(clock.today), 'month'), { months: 1 })
		)
	);
	/** The lists being edited, by stint. */
	let drafts = $state<Record<string, readonly Fact[]>>({});
	const factsIn = (stint: StintRow) => drafts[stint.id] ?? factsOf(rowsOf(stint), shape);
	const names = (stint: StintRow) =>
		of === 'contract_terms'
			? [...TERM_FIELDS, 'signed_on'].map((value) => ({ value, label: fieldLabel(value) }))
			: Object.entries(
					declaredParameters(lawOn(stint, clock.today)?.settings.employee_statutory_parameters)
				).map(([value, { label }]) => ({ value, label }));
	const kindOf = (stint: StintRow) => (fact: Fact) => {
		const law = lawOn(stint, fact.from);
		if (of === 'statutory_parameters')
			return declaredParameters(law?.settings.employee_statutory_parameters)[fact.name];
		if (fact.name === 'allowances') return undefined;
		const values = categoryValues(law)[fact.name];
		const field = exposure?.fields[fact.name];
		const relation = exposure?.relations?.[fact.name];
		if (values !== undefined)
			return { kind: { kind: 'enum' as const, values, optional: true as const } };
		// a reference is its relation: the catalogue lists it apart from the plain fields
		if (relation !== undefined)
			return {
				kind: { kind: 'ref' as const, to: relation.targets[0] ?? '', optional: true as const },
				relation
			};
		return field === undefined ? undefined : { kind: field };
	};
	const written = () =>
		read.stints.flatMap((stint) => {
			const draft = drafts[stint.id];
			return draft === undefined
				? []
				: [{ stint, writes: factWrites(rowsOf(stint), draft, { employment_id: stint.id }, shape) }];
		});
	const acts = () =>
		Object.fromEntries(
			(['create', 'update', 'delete'] as const).flatMap((verb) => {
				const rows = written().flatMap(({ writes }) => writes[verb]);
				return rows.length === 0 ? [] : [[`${of}.${verb}`, rows]];
			})
		);
</script>

<Form
	{ctx}
	of="employee_profile"
	id={person}
	fields={[]}
	{acts}
	confirm={() =>
		written().some(({ stint, writes }) =>
			writes.dates.some((day) => paid.covers(day, stint.entity_id))
		)
			? PAID_QUESTION
			: null}
	on_outcome={(outcome) => {
		if (outcome.kind === 'committed') drafts = {};
	}}
>
	{#snippet children()}
		<Stack gap="md">
			{#if actions !== undefined}<div>{@render actions()}</div>{/if}
			<p class="text-meta">{t('dated.hint')}</p>
			{#if read.loading}
				<p class="text-meta">{t('component.loading')}</p>
			{:else if read.stints.length === 0}
				<EmptyState title={t('person.not_employed_today')} />
			{/if}
			{#each read.stints as stint (stint.id)}
				{#snippet buttons()}{@render stintActions?.(stint)}{/snippet}
				{#snippet allowances({
					fact,
					id,
					set
				}: {
					fact: Fact;
					id: string;
					set: (value: Value) => void;
				})}<AllowanceTermsEditor
						field={{ id, value: fact.value, disabled: false, on_change: set }}
						law={lawOn(stint, fact.from)}
					/>{/snippet}
				<Section
					name="{of}_{stint.id}"
					title="{read.company(stint.entity_id)?.name ?? ''} · {period(stint)}"
					collapsible={false}
					{...stintActions === undefined ? {} : { actions: buttons }}
				>
					<DatedFacts
						{ctx}
						id="{of}-{stint.id}"
						facts={factsIn(stint)}
						names={names(stint)}
						kindOf={kindOf(stint)}
						custom={allowances}
						from={nextMonth}
						onchange={(next) => (drafts = { ...drafts, [stint.id]: next })}
					/>
				</Section>
			{/each}
		</Stack>
	{/snippet}
</Form>
