<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { nullableNumberFrom, numberFrom } from '../../lib/ui/renderer-input.js';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { rateSelectorSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type SelectorKey = Value['by'];

	const KEY_OPTIONS: { value: SelectorKey; label: string; description: string }[] = [
		{ value: 'WAGE', label: 'Wage band', description: 'Matched on the contribution base' },
		{ value: 'WAGE_AND_AGE', label: 'Wage and age', description: 'Base plus employee age' },
		{
			value: 'WAGE_AND_MARITAL',
			label: 'Wage and marital status',
			description: 'Base plus the category the scale is published for'
		},
		{ value: 'HEADCOUNT', label: 'Headcount band', description: 'Matched on company headcount' },
		{ value: 'RISK_CLASS', label: 'Risk class', description: 'Matched on the company risk class' }
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(rateSelectorSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.by === 'RISK_CLASS') return `Risk class ${current.class}`;
		const range = `${current.from} – ${current.to ?? '∞'}`;
		if (current.by === 'WAGE') return `Wage ${range}`;
		if (current.by === 'HEADCOUNT') return `Headcount ${range}`;
		if (current.by === 'WAGE_AND_MARITAL') return `Wage ${range}, ${current.marital.toLowerCase()}`;
		return `Wage ${range}, age ${current.age_from} – ${current.age_to ?? '∞'}`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultFor(key: SelectorKey): Value {
		switch (key) {
			case 'WAGE':
				return { by: 'WAGE', from: 0, to: null };
			case 'WAGE_AND_AGE':
				return { by: 'WAGE_AND_AGE', from: 0, to: null, age_from: 0, age_to: null };
			case 'WAGE_AND_MARITAL':
				return { by: 'WAGE_AND_MARITAL', from: 0, to: null, marital: 'SINGLE' };
			case 'HEADCOUNT':
				return { by: 'HEADCOUNT', from: 0, to: null };
			case 'RISK_CLASS':
				return { by: 'RISK_CLASS', class: '' };
		}
	}

	function selectKey(key: SelectorKey | null): void {
		if (key === null) {
			emit(null);
			return;
		}
		if (current !== null && current.by === key) return;
		emit(defaultFor(key));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Keyed by
				<Combobox
					options={KEY_OPTIONS}
					value={current?.by ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.rate_selector.select_selector')}
					onValueChange={selectKey}
				/>
			</Stack>
		</label>

		{#if current?.by === 'WAGE'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Wage from
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.from}
						{disabled}
						oninput={(event) =>
							emit({ ...current, from: numberFrom(event.currentTarget.value, 0) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Wage to (blank = open ended)
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.to ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, to: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
		{:else if current?.by === 'WAGE_AND_AGE'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Wage from
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.from}
						{disabled}
						oninput={(event) =>
							emit({ ...current, from: numberFrom(event.currentTarget.value, 0) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Wage to (blank = open ended)
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.to ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, to: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Age from
					<Input
						type="number"
						min="0"
						step="1"
						value={current.age_from}
						{disabled}
						oninput={(event) =>
							emit({ ...current, age_from: numberFrom(event.currentTarget.value, 0) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Age to (blank = open ended)
					<Input
						type="number"
						min="0"
						step="1"
						value={current.age_to ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, age_to: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
		{:else if current?.by === 'WAGE_AND_MARITAL'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Wage from
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.from}
						{disabled}
						oninput={(event) =>
							emit({ ...current, from: numberFrom(event.currentTarget.value, 0) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Wage to (blank = open ended)
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.to ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, to: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Marital category
					<Combobox
						options={[
							{
								value: 'SINGLE',
								label: 'No dependent spouse',
								description: 'Unmarried, or married to a spouse who has income'
							},
							{
								value: 'MARRIED',
								label: 'Dependent spouse',
								description: 'Married to a spouse who has no income of their own'
							}
						]}
						value={current.marital}
						{disabled}
						searchable={false}
						emptyPlaceholder={t('renderer.rate_selector.select_category')}
						onValueChange={(next) =>
							emit({ ...current, marital: next === 'MARRIED' ? 'MARRIED' : 'SINGLE' })}
					/>
				</Stack>
			</label>
		{:else if current?.by === 'HEADCOUNT'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Headcount from
					<Input
						type="number"
						min="0"
						step="1"
						value={current.from}
						{disabled}
						oninput={(event) =>
							emit({ ...current, from: numberFrom(event.currentTarget.value, 0) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Headcount to (blank = open ended)
					<Input
						type="number"
						min="0"
						step="1"
						value={current.to ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, to: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
		{:else if current?.by === 'RISK_CLASS'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Risk class
					<Input
						value={current.class}
						{disabled}
						placeholder={t('component.rate_example')}
						oninput={(event) => emit({ by: 'RISK_CLASS', class: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{/if}
	</Grid>
{/if}
