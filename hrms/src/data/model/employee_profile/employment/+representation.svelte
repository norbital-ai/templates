<script lang="ts">
	/**
	 * One stint of a person with one company: its number, its days, the service credited to it and, once it has a last
	 * day, the exit answers. The last day is set, moved or cleared here (clearing it cancels the exit). The first day
	 * moves in one write: the stint carries its first terms and statutory parameters along. A stint nothing names may be deleted.
	 */
	import type { PlainDate } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Editor,
		Field,
		Form,
		Label,
		RecordShell,
		Sheet,
		value_object,
		type FieldEditor,
		type FormProps,
		type RecordView
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { PAID_QUESTION, paidPeriods } from '../../../../lib/ui/payroll/paid_period.svelte.js';
	import DeleteButton from '../../../../lib/ui/person/delete_button.svelte';
	import { saved } from '../../../../lib/ui/person/save.js';

	let { view, ctx }: { view: RecordView<'employment'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const paid = paidPeriods(ctx);
	const dayOf = (range: unknown, end: 'from' | 'to') =>
		value_object(range) && range[end] != null ? String(range[end]).slice(0, 10) : null;
	/** A last day set, moved or cleared in a paid period amends it: HR is asked first. */
	const confirm: NonNullable<FormProps['confirm']> = ({ values, before }) =>
		[values, before].some((row) =>
			paid.covers(dayOf(row['effective_range'], 'to'), row['entity_id'])
		)
			? PAID_QUESTION
			: null;
	let moving = $state(false);
	let firstDay = $state<PlainDate | null>(null);
	let saving = $state(false);
	function move() {
		const day = firstDay;
		if (record === null || day === null || saving) return;
		const from = record.effective_range.from;
		// the stint carries the rows dated on its first day along
		const target = { id: record.id, revision: record.revision };
		const range = { from: day, to: record.effective_range.to ?? null };
		saving = true;
		fork(
			saved(ctx, paid.covers(from, record.entity_id) || paid.covers(day, record.entity_id), () =>
				ctx.act({ 'employment.update': [{ target, set: { effective_range: range } }] })
			).pipe(
				Effect.tap((done) => Effect.sync(() => done && (moving = false))),
				Effect.ensuring(Effect.sync(() => (saving = false)))
			)
		);
	}
</script>

{#snippet lastDay(field: FieldEditor)}<Editor
		{ctx}
		id={field.id}
		name="last_day"
		kind={{ kind: 'date', optional: true }}
		value={dayOf(field.value, 'to')}
		disabled={field.disabled}
		on_change={(next) =>
			field.on_change({ ...(value_object(field.value) ? field.value : {}), to: next ?? null })}
	/>{/snippet}

{#snippet actions()}{#if record !== null}<Button
			variant="outline"
			onclick={() => {
				firstDay = record.effective_range.from;
				moving = true;
			}}>{t('person.move_first_day')}</Button
		><DeleteButton
			{ctx}
			label={t('person.delete_stint')}
			title={t('person.delete_stint_title')}
			body={t('person.delete_stint_body')}
			act={() =>
				ctx.act({
					'employment.delete': [{ target: { id: record.id, revision: record.revision } }]
				})}
		/>{/if}{/snippet}

<RecordShell
	{ctx}
	of="employment"
	mode={view.mode}
	footer_actions={actions}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}
		<Form {ctx} of="employment" mode="create" values={view.mode === 'create' ? view.values : {}} />
	{:else}
		<Form {ctx} of="employment" mode="update" id={record.id} {record} {confirm}>
			{#snippet children()}<Stack gap="md">
					{#each ['employee_id', 'entity_id', 'employee_number'] as name (name)}<Field
							{ctx}
							{name}
						/>{/each}
					<Field
						{ctx}
						name="effective_range"
						label={t('contract.last_working_day')}
						editor={lastDay}
					/>
					{#each ['service_started_on', 'exit_ground', 'encash_leave', 'final_pay_due_on', 'reason'] as name (name)}<Field
							{ctx}
							{name}
						/>{/each}
				</Stack>{/snippet}
		</Form>
	{/if}
</RecordShell>

{#if record !== null}
	<Sheet bind:open={moving} title={t('person.move_first_day')}>
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
				<Button variant="outline" disabled={saving} onclick={() => (moving = false)}
					>{t('component.cancel')}</Button
				>
				<Button disabled={saving || firstDay === null} onclick={move}>{t('person.save')}</Button>
			</Cluster>
		</Stack>
	</Sheet>
{/if}
