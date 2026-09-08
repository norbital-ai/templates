<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import ContributionTreatments from '../contribution_treatments/+renderer.svelte';
	import { payItemMetadataInputSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const decoded = $derived(Schema.decodeUnknownResult(payItemMetadataInputSchema)(props.value));
	const current = $derived(
		Result.isSuccess(decoded)
			? decoded.success
			: {
					code: '',
					sequence: 0,
					contribution_treatments: {}
				}
	);
	function emit(change: Partial<Value>): void {
		if (props.mode === 'edit') props.onValueChange({ ...current, ...change });
	}
</script>

{#if props.mode === 'display'}
	<span>{current.code || '—'}</span>
{:else}
	<Grid gap="sm" minimum="compact">
		<label class="text-sm"
			><Stack gap="xs">
				{t('component.code')}
				<Input
					value={current.code}
					{disabled}
					oninput={(event) => emit({ code: event.currentTarget.value })}
				/>
			</Stack></label
		>
		<label class="text-sm"
			><Stack gap="xs">
				{t('component.applied_at')}
				<Input
					type="number"
					step="1"
					value={current.sequence}
					{disabled}
					oninput={(event) => emit({ sequence: Number(event.currentTarget.value) })}
				/>
			</Stack></label
		>
		<Column span="all"
			><Stack gap="xs">
				<span class="text-sm">{t('component.contribution_treatments')}</span>
				<ContributionTreatments
					mode="edit"
					field={{ name: 'contribution_treatments', type: 'contribution_treatments' }}
					value={current.contribution_treatments}
					{disabled}
					onValueChange={(value) => emit({ contribution_treatments: value ?? {} })}
				/>
			</Stack></Column
		>
	</Grid>
{/if}
