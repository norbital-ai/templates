<script lang="ts">
	/**
	 * One stint of a person with one company, as its own record: its number, its days, the service credited to it, its
	 * dated life events and, once it has a last day, the exit answers. HR works on a stint from the person's Contract
	 * tab, where these answers sit on its line of time and the stint is moved or deleted.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Editor,
		Field,
		Form,
		RecordShell,
		Show,
		value_object,
		type FieldEditor,
		type FieldView,
		type FormProps,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { PAID_QUESTION, paidPeriods } from '../../../../lib/ui/payroll/paid_period.svelte.js';

	let { view, ctx }: { view: RecordView<'employment'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const paid = paidPeriods(ctx);
	const dayOf = (range: unknown, end: 'from' | 'to') =>
		value_object(range) && range[end] != null ? String(range[end]).slice(0, 10) : null;
	const eventDays = (row: { readonly [field: string]: unknown }) =>
		(Array.isArray(row['events']) ? row['events'] : []).flatMap((event) =>
			value_object(event) && typeof event.on === 'string' ? [event.on] : []
		);
	/** A last day set, moved or cleared in a paid period, or a life event changed in one, amends it: HR is asked first. */
	const confirm: NonNullable<FormProps['confirm']> = ({ values, before }) =>
		[values, before].some((row) =>
			paid.covers(dayOf(row['effective_range'], 'to'), row['entity_id'])
		) ||
		(JSON.stringify(values['events'] ?? []) !== JSON.stringify(before['events'] ?? []) &&
			[values, before].some((row) =>
				eventDays(row).some((day) => paid.covers(day, row['entity_id']))
			))
			? PAID_QUESTION
			: null;
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

{#snippet lastDayShown(field: FieldView)}<Show
		{ctx}
		readonly
		id={field.id}
		name="last_day"
		kind={{ kind: 'date', optional: true }}
		value={dayOf(field.value, 'to')}
	/>{/snippet}

<RecordShell
	{ctx}
	of="employment"
	mode={view.mode}
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
						view={lastDayShown}
					/>
					{#each ['service_started_on', 'exit_ground', 'encash_leave', 'final_pay_due_on', 'reason', 'events'] as name (name)}<Field
							{ctx}
							{name}
						/>{/each}
				</Stack>{/snippet}
		</Form>
	{/if}
</RecordShell>
