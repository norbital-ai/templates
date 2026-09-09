<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import SelectorRenderer from '../rate_selector/+renderer.svelte';
	import AwardRenderer from '../rate_award/+renderer.svelte';
	import { contributionBandSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(Schema.Array(contributionBandSchema))(props.value ?? [])
	);
	const rows = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
	/** Empty is everyone, and is stored as no key at all. */
	function editEligibility(index: number, eligibility: string): void {
		emit(
			rows.map((row, position) => {
				if (position !== index) return row;
				const { eligibility: _previous, ...rest } = row;
				return eligibility.trim() === '' ? rest : { ...rest, eligibility };
			})
		);
	}
	const selectorField = { name: 'selector', type: 'custom' };
	const awardField = { name: 'award', type: 'custom' };
</script>

{#if props.mode === 'display'}
	<span>{t('component.rate_band_count', { count: rows.length })}</span>
{:else}
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('component.rate_bands_description')}</p>
		{#each rows as row, index (index)}
			<Stack gap="sm" class="border-b border-border pb-3">
				<Grid gap="md" minimum="panel">
					<SelectorRenderer
						mode="edit"
						field={selectorField}
						value={row.selector}
						{disabled}
						onValueChange={(selector) => {
							if (selector != null) edit(index, { selector });
						}}
					/>
					<AwardRenderer
						mode="edit"
						field={awardField}
						value={row.award}
						{disabled}
						onValueChange={(award) => {
							if (award != null) edit(index, { award });
						}}
					/>
				</Grid>
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('component.band_eligibility')}
						<Input
							value={row.eligibility ?? ''}
							{disabled}
							placeholder={'employee.citizenship == "FOREIGNER"'}
							oninput={(event) => editEligibility(index, event.currentTarget.value)}
						/>
					</Stack>
				</label>
				<Cluster
					><Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => emit(rows.filter((_, position) => position !== index))}
						>{t('component.remove_rate_band')}</Button
					></Cluster
				>
			</Stack>
		{/each}
		<Cluster
			><Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() =>
					emit([
						...rows,
						{
							selector: { by: 'WAGE', from: 0, to: null },
							award: { kind: 'PERCENT', employee: 0, employer: 0 }
						}
					])}>{t('component.add_rate_band')}</Button
			></Cluster
		>
	</Stack>
{/if}
