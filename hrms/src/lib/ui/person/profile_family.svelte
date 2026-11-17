<script lang="ts">
	/** A person's dependants, by birth or expected date, newest first. A row opens its own record. */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		EmptyState,
		Form,
		open_record,
		RecordShell,
		Section,
		Sheet,
		enum_text,
		format,
		label
	} from '@norbital-ai/ui';
	import VersionTimeline from '../components/version_timeline.svelte';
	import { paidPeriods } from '../payroll/paid_period.svelte.js';
	import type { PersonRead } from './person_read.svelte.js';

	let {
		ctx,
		person,
		read
	}: { ctx: PageContext; person: Id<'employee_profile'>; read: PersonRead } = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const paid = paidPeriods(ctx);
	let adding = $state(false);
	const day = (value: unknown) => format({ kind: 'date' }, String(value), { locale: ctx.locale });
	const items = $derived(
		read.dependants
			.map((row) => ({ row, on: String(row.born_on ?? row.expected_on ?? '') }))
			.toSorted((left, right) => right.on.localeCompare(left.on))
			.map(({ row, on }) => ({
				id: String(row.id),
				period:
					row.born_on != null
						? day(on)
						: on === ''
							? (row.name ?? '')
							: `${t('person.expected')} · ${day(on)}`,
				status: label(ctx, 'dependant', `relation.${row.relation}`, enum_text(row.relation)),
				detail: [
					...(row.name == null || on === '' ? [] : [row.name]),
					...(['has_income', 'disabled', 'studying'] as const).flatMap((flag) =>
						row[flag] === true ? [label(ctx, 'dependant', flag)] : []
					)
				].join(' · ')
			}))
	);
</script>

{#snippet add()}<Button variant="outline" onclick={() => (adding = true)}
		>{t('person.add_dependant')}</Button
	>{/snippet}

<Section
	name="person_family"
	title={t('models.dependant.label')}
	first
	collapsible={false}
	actions={add}
>
	{#if read.loading}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if items.length === 0}
		<EmptyState title={t('person.family_empty')} />
	{:else}
		<VersionTimeline
			label={t('models.dependant.label')}
			{items}
			onOpen={(id) => open_record('dependant', id)}
		/>
	{/if}
</Section>

<Sheet bind:open={adding} title={t('person.add_dependant')}>
	<RecordShell
		{ctx}
		of="dependant"
		mode="create"
		on_done={(outcome) => {
			if (outcome.kind === 'committed') adding = false;
		}}
	>
		<Form
			{ctx}
			of="dependant"
			mode="create"
			values={{ employee_id: person }}
			confirm={paid.confirm(() => false, ['born_on', 'expected_on'])}
		/>
	</RecordShell>
</Sheet>
