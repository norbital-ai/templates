<script lang="ts">
	/**
	 * The economic type is a picker that fixes the settlement direction. Statutory chargeability is
	 * not here: it is the component's `contribution_treatments`, one cell per scheme code.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Stack } from '@norbital-ai/ui/layout';
	import { componentPolicySchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type Kind = Value['kind'];

	const KIND_OPTIONS: { value: Kind; label: string; description: string }[] = [
		{ value: 'INFORMATION', label: 'Information', description: 'Recorded, never settled' },
		{ value: 'EARNING', label: 'Earning', description: 'Added to pay' },
		{ value: 'ABSENCE', label: 'Absence', description: 'Deducted for time not worked' },
		{ value: 'DEDUCTION', label: 'Deduction', description: 'Deducted from pay' },
		{
			value: 'NON_WAGE_PAYMENT',
			label: 'Non-wage payment',
			description: 'Added, but not wages'
		},
		{
			value: 'EMPLOYER_COST',
			label: 'Employer cost',
			description: 'Borne by the employer alone'
		}
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(componentPolicySchema)(props.value, { onExcessProperty: 'error' })
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived(
		current === null
			? '—'
			: `${current.kind.replaceAll('_', ' ').toLowerCase()} · ${current.settlement.toLowerCase()}`
	);

	/** The settlement direction each arm fixes — the reason the arm is a closed union at all. */
	function atKind(kind: Kind): Value {
		switch (kind) {
			case 'INFORMATION':
				return { kind, settlement: 'NONE' };
			case 'EARNING':
				return { kind, settlement: 'ADD' };
			case 'ABSENCE':
				return { kind, settlement: 'DEDUCT' };
			case 'DEDUCTION':
				return { kind, settlement: 'DEDUCT' };
			case 'NON_WAGE_PAYMENT':
				return { kind, settlement: 'ADD' };
			case 'EMPLOYER_COST':
				return { kind, settlement: 'EMPLOYER_ONLY' };
		}
	}

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function selectKind(kind: Kind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(atKind(kind));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border border-border bg-muted/20 p-3">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Economic type
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.component_policy.select_economic_type')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>
		{#if current !== null}
			<p class="text-meta">
				Settles as {current.settlement.replaceAll('_', ' ').toLowerCase()}, fixed by the economic
				type. How each statutory scheme charges it is the component's contribution treatments.
			</p>
		{/if}
	</Stack>
{/if}
