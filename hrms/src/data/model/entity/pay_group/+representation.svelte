<script lang="ts">
	/**
	 * A pay group: its name and its schedule. The schedule shows the fields its frequency has, and the record's one
	 * Save stores it as the model holds it.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Editor,
		Field,
		Form,
		Label,
		RecordShell,
		type FieldEditor,
		type Fields,
		type FieldView,
		type Kind,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { jsonObject } from '../../../../lib/payroll_engine/foundation.js';
	import { scheduleSummary } from '../../../../lib/ui/payroll/schedule_summary.js';

	let { view, ctx }: { view: RecordView<'pay_group'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	/** A schedule's fields, in the order they are read; a frequency shows those it has. */
	const FIELDS = [
		'pay_days',
		'pay_cutoff_day',
		'weekday',
		'month_interval',
		'anchor_date',
		'business_day',
		'non_working_weekdays',
		'short_month'
	] as const;
	/** The fields each frequency has, as the model declares them. */
	const armsOf = (kind: Kind): Readonly<Record<string, Fields>> => {
		const shape = kind.kind === 'json' ? kind.shape : undefined;
		return shape?.kind === 'union' && 'arms' in shape ? shape.arms : {};
	};
</script>

{#snippet schedule(field: FieldEditor)}
	{@const arms = armsOf(field.kind)}
	{@const held = jsonObject(field.value ?? {})}
	{@const arm = arms[String(held.frequency)]}
	<Stack gap="md">
		<Stack gap="xs">
			<Label for={field.id}>{ctx.t('models.pay_group.fields.payment_schedule.frequency')}</Label>
			<Editor
				{ctx}
				id={field.id}
				name="payment_schedule.frequency"
				kind={{ kind: 'enum', values: Object.keys(arms) }}
				value={held.frequency ?? null}
				disabled={field.disabled}
				on_change={(next) =>
					field.on_change({
						...Object.fromEntries(
							Object.entries(held).filter(([name]) => Object.hasOwn(arms[String(next)] ?? {}, name))
						),
						frequency: next
					})}
			/>
		</Stack>
		{#each FIELDS as name (name)}
			{@const kind = arm?.[name]}
			{#if kind !== undefined}
				<Stack gap="xs">
					<Label for="{field.id}-{name}"
						>{ctx.t(`models.pay_group.fields.payment_schedule.${name}`)}</Label
					>
					<Editor
						{ctx}
						id="{field.id}-{name}"
						name="payment_schedule.{name}"
						{kind}
						value={held[name] ?? null}
						disabled={field.disabled}
						on_change={(next) => field.on_change({ ...held, [name]: next })}
					/>
				</Stack>
			{/if}
		{/each}
	</Stack>
{/snippet}

{#snippet summary(field: FieldView)}{scheduleSummary(ctx, field.value)}{/snippet}

<RecordShell
	{ctx}
	of="pay_group"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="pay_group"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}
			<Stack gap="md">
				{#if record === null}<Field {ctx} name="entity_id" />{/if}
				<Field {ctx} name="name" />
				<Field {ctx} name="payment_schedule" editor={schedule} view={summary} />
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
