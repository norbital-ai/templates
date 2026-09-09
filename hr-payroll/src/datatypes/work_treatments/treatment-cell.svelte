<script lang="ts">
	/**
	 * One cell of the work treatments matrix: the scheme's charge on one pay line, and the rule's
	 * name only when the charge is special. Folding the rule into the cell keeps the matrix at one
	 * column per pay line, which is what fits a record sheet.
	 */
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Stack } from '@norbital-ai/ui/layout';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { ContributionTreatment } from '../contribution_treatment/+definition.js';

	type Kind = ContributionTreatment['kind'];
	const KINDS: readonly Kind[] = ['INCLUDE', 'EXCLUDE', 'REDUCE', 'SPECIAL', 'UNSET'];
	const isKind = (value: unknown): value is Kind => KINDS.includes(value as Kind);

	let {
		value,
		mode = 'display',
		disabled = false,
		onValueChange
	}: {
		value: unknown;
		mode?: 'display' | 'edit';
		disabled?: boolean;
		onValueChange?: (value: unknown) => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const treatment = $derived<ContributionTreatment>(
		typeof value === 'object' && value != null && isKind((value as { kind?: unknown }).kind)
			? (value as ContributionTreatment)
			: { kind: 'UNSET' }
	);
	const rule = $derived(treatment.kind === 'SPECIAL' ? treatment.rule : '');
	const emit = (kind: Kind, nextRule: string): void =>
		onValueChange?.(kind === 'SPECIAL' ? { kind, rule: nextRule } : { kind });
</script>

{#if mode === 'display'}
	<span class="block truncate">{treatment.kind}{rule ? ` · ${rule}` : ''}</span>
{:else}
	<Stack gap="xs">
		<Combobox
			options={KINDS.map((kind) => ({ value: kind, label: kind }))}
			value={treatment.kind}
			{disabled}
			searchable={false}
			onValueChange={(next) => {
				if (isKind(next)) emit(next, rule);
			}}
		/>
		{#if treatment.kind === 'SPECIAL'}
			<Input
				value={rule}
				{disabled}
				placeholder={t('renderer.contribution_treatments.special_rule')}
				oninput={(event) => emit('SPECIAL', event.currentTarget.value)}
			/>
		{/if}
	</Stack>
{/if}
