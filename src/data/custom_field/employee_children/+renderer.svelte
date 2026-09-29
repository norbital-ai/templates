<script lang="ts">
	import RowList from '../../../lib/ui/row-list.svelte';
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';

	import { Combobox, DateInput, Input } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { dateKey } from '../../../lib/iso-day.js';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import { decodeNumber } from '../../../lib/wire.js';
	type Count = number | null;
	type Value = readonly {
		readonly child_birthdate: string;
		readonly estimated_delivery_date?: string | null;
		readonly adoption_eligibility_date?: string | null;
		readonly relationship: 'CHILD' | 'STEPCHILD' | 'ADOPTED' | 'LEGAL_WARD';
		readonly effective_range?: { readonly start: string; readonly end: string | null } | null;
		readonly citizenship?: string | null;
		readonly shared_parental_weeks?: Count;
		readonly prior_employment_days?: Count;
		readonly prior_childcare_days?: Count;
		readonly prior_extended_childcare_days?: Count;
		readonly prior_infant_care_days?: Count;
		readonly relief_class?: string | null;
	}[];

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const rows = $derived(view.value ?? []);
	const relationships = ['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD'] as const;
	function emit(value: Value): void {
		if (view.mode === 'edit') view.onChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
	/** The stored range bounds are day-precision instants; the inputs are calendar days. */
	const day = (value: string | null | undefined) => dateKey(value);
	const dayInstant = (value: string) => `${value}T00:00:00.000Z`;
	/** A blank count is unrecorded; anything else is the whole number typed. */
	const count = (text: string): number | null =>
		text.trim() === '' ? null : Math.max(0, Math.trunc(decodeNumber(text)) || 0);
</script>

{#if view.mode === 'show'}
	<span>{t('employee_children.count', { count: rows.length })}</span>
{:else}
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('employee_children.append_only_hint')}</p>
		<RowList
			{rows}
			{disabled}
			addLabel={t('employee_children.add')}
			add={() =>
				emit([...rows, { child_birthdate: '', relationship: 'CHILD', effective_range: null }])}
		>
			{#snippet row(row, index)}
				<Labelled label={t('employee_children.birthdate')}>
					<DateInput
						value={row.child_birthdate || null}
						{disabled}
						onChange={(next) => edit(index, { child_birthdate: next ?? '' })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.estimated_delivery_date')}>
					<DateInput
						value={row.estimated_delivery_date || null}
						{disabled}
						onChange={(next) => edit(index, { estimated_delivery_date: next })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.adoption_eligibility_date')}>
					<DateInput
						value={row.adoption_eligibility_date || null}
						{disabled}
						onChange={(next) => edit(index, { adoption_eligibility_date: next })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.relationship')}>
					<Combobox
						options={relationships.map((value) => ({ value, label: value }))}
						value={row.relationship}
						{disabled}
						onChange={(relationship) => relationship != null && edit(index, { relationship })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.effective_from')}>
					<DateInput
						value={day(row.effective_range?.start) || null}
						{disabled}
						onChange={(next) =>
							edit(index, {
								effective_range:
									next == null
										? null
										: { start: dayInstant(next), end: row.effective_range?.end ?? null }
							})}
					/>
				</Labelled>
				<Labelled label={t('employee_children.effective_to')}>
					<DateInput
						value={day(row.effective_range?.end) || null}
						disabled={disabled || row.effective_range == null}
						onChange={(next) =>
							edit(index, {
								effective_range: {
									start: row.effective_range?.start ?? '',
									end: next == null ? null : dayInstant(next)
								}
							})}
					/>
				</Labelled>
				<Labelled label={t('employee_children.citizenship')}>
					<Input
						value={row.citizenship ?? ''}
						{disabled}
						placeholder="CITIZEN"
						oninput={(event) =>
							edit(index, { citizenship: event.currentTarget.value.trim() || null })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.relief_class')}>
					<Input
						value={row.relief_class ?? ''}
						{disabled}
						placeholder="TERTIARY"
						oninput={(event) =>
							edit(index, { relief_class: event.currentTarget.value.trim() || null })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.shared_parental_weeks')}>
					<Input
						type="number"
						min="0"
						step="1"
						value={row.shared_parental_weeks ?? ''}
						{disabled}
						oninput={(event) =>
							edit(index, { shared_parental_weeks: count(event.currentTarget.value) })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.prior_employment_days')}>
					<Input
						type="number"
						min="0"
						step="1"
						value={row.prior_employment_days ?? ''}
						{disabled}
						oninput={(event) =>
							edit(index, { prior_employment_days: count(event.currentTarget.value) })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.prior_childcare_days')}>
					<Input
						type="number"
						min="0"
						step="1"
						value={row.prior_childcare_days ?? ''}
						{disabled}
						oninput={(event) =>
							edit(index, { prior_childcare_days: count(event.currentTarget.value) })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.prior_extended_childcare_days')}>
					<Input
						type="number"
						min="0"
						step="1"
						value={row.prior_extended_childcare_days ?? ''}
						{disabled}
						oninput={(event) =>
							edit(index, { prior_extended_childcare_days: count(event.currentTarget.value) })}
					/>
				</Labelled>
				<Labelled label={t('employee_children.prior_infant_care_days')}>
					<Input
						type="number"
						min="0"
						step="1"
						value={row.prior_infant_care_days ?? ''}
						{disabled}
						oninput={(event) =>
							edit(index, { prior_infant_care_days: count(event.currentTarget.value) })}
					/>
				</Labelled>
			{/snippet}
		</RowList>
	</Stack>
{/if}
