<script lang="ts">
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';

	import { Combobox, Input } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ProrationBasis as Value } from '../../../lib/datatypes/proration_basis.js';
	import { numberFrom } from '../../../lib/ui/renderer-input.js';

	type Basis = Value['by'];

	const BASIS_OPTIONS: { value: Basis; label: string; description: string }[] = $derived([
		{
			value: 'CALENDAR_DAYS',
			label: t('proration.calendar_days'),
			description: t('proration.calendar_days_hint')
		},
		{
			value: 'WORKING_DAYS',
			label: t('proration.working_days'),
			description: t('proration.working_days_hint')
		},
		{
			value: 'FIXED_DAYS',
			label: t('proration.fixed_days'),
			description: t('proration.fixed_days_hint')
		}
	]);

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const current = $derived(view.value);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.by === 'FIXED_DAYS') return t('proration.fixed_n', { days: current.days });
		if (current.by === 'CALENDAR_DAYS')
			return current.days == null
				? t('proration.calendar_days')
				: t('proration.calendar_over', { days: current.days });
		return t('proration.working_days');
	});

	function emit(next: Value | null): void {
		if (view.mode === 'edit') view.onChange(next);
	}

	function defaultFor(basis: Basis): Value {
		switch (basis) {
			case 'CALENDAR_DAYS':
				return { by: 'CALENDAR_DAYS' };
			case 'WORKING_DAYS':
				return { by: 'WORKING_DAYS' };
			case 'FIXED_DAYS':
				return { by: 'FIXED_DAYS', days: 26 };
		}
	}

	function selectBasis(basis: Basis | null): void {
		if (basis === null) {
			emit(null);
			return;
		}
		if (current !== null && current.by === basis) return;
		emit(defaultFor(basis));
	}
</script>

{#if view.mode === 'show'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm">
		<Combobox
			class="w-64 max-w-full"
			size="sm"
			aria-label={t('renderer.proration_basis.basis')}
			options={BASIS_OPTIONS}
			value={current?.by ?? null}
			{disabled}
			placeholder={t('renderer.proration_basis.select_basis')}
			onChange={selectBasis}
		/>
		{#if current?.by === 'CALENDAR_DAYS'}
			<Labelled label={t('renderer.proration_basis.days')} class="text-xs" muted>
				<Input
					type="number"
					min="1"
					step="1"
					value={current.days ?? ''}
					{disabled}
					oninput={(event) =>
						emit(
							event.currentTarget.value === ''
								? { by: 'CALENDAR_DAYS' }
								: { by: 'CALENDAR_DAYS', days: numberFrom(event.currentTarget.value, 30) }
						)}
				/>
			</Labelled>
		{:else if current?.by === 'FIXED_DAYS'}
			<Labelled label={t('renderer.proration_basis.days')} class="text-xs" muted>
				<Input
					type="number"
					min="0.5"
					step="0.5"
					value={current.days}
					{disabled}
					oninput={(event) =>
						emit({ by: 'FIXED_DAYS', days: numberFrom(event.currentTarget.value, 1) })}
				/>
			</Labelled>
		{/if}
	</Stack>
{/if}
