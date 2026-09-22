<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { employeeChildSchema } from './+definition.js';
	import { dateKey } from '../../lib/iso-day.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(Schema.Array(employeeChildSchema))(props.value ?? [])
	);
	const rows = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	const relationships = ['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD'] as const;
	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
	/** The stored range bounds are day-precision instants; the inputs are calendar days. */
	const day = (value: string | null | undefined) => dateKey(value);
	const dayInstant = (value: string) => `${value}T00:00:00.000Z`;
	/** A blank count is unrecorded; anything else is the whole number typed. */
	const count = (text: string): number | null =>
		text.trim() === '' ? null : Math.max(0, Math.trunc(Number(text)) || 0);
</script>

{#if props.mode === 'display'}
	<span>{t('employee_children.count', { count: rows.length })}</span>
{:else}
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('employee_children.append_only_hint')}</p>
		{#each rows as row, index (index)}
			<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.birthdate')}<Input
							type="date"
							value={row.child_birthdate}
							{disabled}
							oninput={(event) => edit(index, { child_birthdate: event.currentTarget.value })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.relationship')}<select
							class="h-9 rounded-md border border-input bg-background px-2 text-sm"
							value={row.relationship}
							{disabled}
							onchange={(event) =>
								edit(index, {
									relationship: event.currentTarget.value as Value[number]['relationship']
								})}
						>
							{#each relationships as relationship (relationship)}
								<option value={relationship}>{relationship}</option>
							{/each}
						</select></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.effective_from')}<Input
							type="date"
							value={day(row.effective_range?.start)}
							{disabled}
							oninput={(event) =>
								edit(index, {
									effective_range: event.currentTarget.value
										? {
												start: dayInstant(event.currentTarget.value),
												end: row.effective_range?.end ?? null
											}
										: null
								})}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.effective_to')}<Input
							type="date"
							value={day(row.effective_range?.end)}
							disabled={disabled || row.effective_range == null}
							oninput={(event) =>
								edit(index, {
									effective_range: {
										start: row.effective_range?.start ?? '',
										end: event.currentTarget.value ? dayInstant(event.currentTarget.value) : null
									}
								})}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.citizenship')}<Input
							value={row.citizenship ?? ''}
							{disabled}
							placeholder="CITIZEN"
							oninput={(event) =>
								edit(index, { citizenship: event.currentTarget.value.trim() || null })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.relief_class')}<Input
							value={row.relief_class ?? ''}
							{disabled}
							placeholder="TERTIARY"
							oninput={(event) =>
								edit(index, { relief_class: event.currentTarget.value.trim() || null })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.shared_parental_weeks')}<Input
							type="number"
							min="0"
							step="1"
							value={row.shared_parental_weeks ?? ''}
							{disabled}
							oninput={(event) =>
								edit(index, { shared_parental_weeks: count(event.currentTarget.value) })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.prior_employment_days')}<Input
							type="number"
							min="0"
							step="1"
							value={row.prior_employment_days ?? ''}
							{disabled}
							oninput={(event) =>
								edit(index, { prior_employment_days: count(event.currentTarget.value) })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.prior_childcare_days')}<Input
							type="number"
							min="0"
							step="1"
							value={row.prior_childcare_days ?? ''}
							{disabled}
							oninput={(event) =>
								edit(index, { prior_childcare_days: count(event.currentTarget.value) })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.prior_extended_childcare_days')}<Input
							type="number"
							min="0"
							step="1"
							value={row.prior_extended_childcare_days ?? ''}
							{disabled}
							oninput={(event) =>
								edit(index, { prior_extended_childcare_days: count(event.currentTarget.value) })}
						/></Stack
					></label
				>
				<label class="text-sm"
					><Stack gap="xs"
						>{t('employee_children.prior_infant_care_days')}<Input
							type="number"
							min="0"
							step="1"
							value={row.prior_infant_care_days ?? ''}
							{disabled}
							oninput={(event) =>
								edit(index, { prior_infant_care_days: count(event.currentTarget.value) })}
						/></Stack
					></label
				>
			</Grid>
		{/each}
		<Cluster
			><Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() =>
					emit([...rows, { child_birthdate: '', relationship: 'CHILD', effective_range: null }])}
				>{t('employee_children.add')}</Button
			></Cluster
		>
	</Stack>
{/if}
